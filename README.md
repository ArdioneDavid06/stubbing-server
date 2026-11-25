# @rmc/stubbing

A stub server for third-party APIs: install a rule at runtime instead of rebuilding a fake.

Every integration waits for somebody else — a sandbox that is down, an account nobody
provisioned, a dataset that does not exist yet. The wait is usually not about code. It is
about **an endpoint and an example response** that nobody has written down.

Point a service's third-party base URL at this and give it the example response. The
integration starts the day the partner sends a document rather than the day they send
credentials.

**What it is not:** a mock inside a test, a schema validator, or a replacement for the
partner's sandbox. It proves *our* side. It cannot prove theirs.

- [Quick start](#quick-start) · [The contract](docs/contract-v1.md) · [Rules that do not lie](#rules-that-do-not-lie) · [Presets](#presets) · [Versioning](#versioning)

---

## Quick start

Needs Docker, and nothing else. No database, no Redis, no credentials.

```bash
docker build -t rmc/stubbing:1 .
docker run --rm -p 4010:4010 rmc/stubbing:1
```

Or copy one file into your repository and let compose do it:

```bash
docker compose -f docker-compose.stub.yml up -d
```

Then point the consuming application at it, and change nothing else:

```yaml
PARTNER_BASE_URL: http://stub:4010
PARTNER_TOKEN_URL: http://stub:4010/oauth/token
```

### Two rules, and the integration can be written today

Say a partner sends: `GET /v2/customers/{id}`, returns a customer, and 404s when the
customer is unknown.

```bash
# the success
curl -sX POST localhost:4010/stub/rules -H 'content-type: application/json' -d '{
  "method": "GET",
  "path": "/v2/customers/:id",
  "status": 200,
  "body": { "id": "C-1", "name": "Ada", "tier": "GOLD" },
  "description": "partner docs, GET /v2/customers/{id} example response"
}'

# the failure the ticket names
curl -sX POST localhost:4010/stub/rules -H 'content-type: application/json' -d '{
  "method": "GET",
  "path": "/v2/customers/missing",
  "status": 404,
  "body": { "error": "CUSTOMER_NOT_FOUND" },
  "description": "ticket INT-214, unknown customer",
  "times": 1
}'
```

Call them:

```bash
curl -s localhost:4010/v2/customers/C-1        # 200, the documented body
curl -s localhost:4010/v2/customers/missing    # 404 once, then 404 from the stub itself
```

### Make one call fail, without installing a rule

A partner will not answer `409` because a test asked nicely. This will:

```bash
curl -sX POST localhost:4010/stub/failures -H 'content-type: application/json' \
  -d '{"key":"C-9","status":409,"body":{"error":"TOO_SOON"}}'

curl -s localhost:4010/v2/customers/C-9?key=C-9   # 409, once
```

### Prove what the application actually sent

A service can answer `200` to its caller while sending the partner a body the partner will
reject. The recorder is the only assertion that catches that — and it records the 404s,
which are the most useful thing a stub can report.

```bash
curl -s 'localhost:4010/stub/requests?path=customers'
```

```json
[
  {
    "sequence": 1,
    "method": "POST",
    "path": "/v2/customers",
    "query": {},
    "headers": { "content-type": "application/json" },
    "body": { "id": "C-1", "tier": "gold" },
    "receivedAt": "2026-11-26T08:00:00.000Z",
    "responseStatus": 200
  }
]
```

The whole day-one flow is executable: [`examples/day-one.sh`](examples/day-one.sh).

---

## The contract

Three shapes are the API. Everything else — routes, modules, presets, internals — may
move. The full field-by-field version is [docs/contract-v1.md](docs/contract-v1.md).

### A rule

Two shapes describe the same rule, and **both keep working**, because a rule is a
document a team pastes into a wiki.

```json
{
  "method": "PUT",
  "path": "/partner/v1/orders/42",
  "status": 409,
  "body": { "message": "too soon", "retryAfterSeconds": 10 },
  "sessionId": "checkout-run-7",
  "times": 1
}
```

```json
{
  "request": {
    "method": "PUT",
    "path": "/partner/v1/orders/42",
    "query": { "region": "ph" },
    "headers": { "authorization": "/^Bearer /" },
    "body": { "kind": "blue" }
  },
  "response": { "status": 409, "body": { "message": "too soon" } }
}
```

- `method` defaults to `*`, `status` to `200`
- `path` supports `:name` (one segment) and `*` (anything, including `/`)
- in the flat shape, `body` and `headers` are the **answer**, not the body to match
- the long shape is where a rule narrows on request `query`, `headers` or `body`
- `times` — how many calls it answers; omitted means until deleted
- `sessionId` — scopes the rule to one run; see [sessions](#sessions)
- `description` — where the rule came from. Write it. See [rules that do not lie](#rules-that-do-not-lie)

A rule that mixes both shapes is refused with a 400 that names the fields, rather than
silently answering something nobody asked for.

`GET /stub/rules` returns the normalised (long) shape plus `form: "flat" | "long"` and
`remaining`, so an installed rule can be read back out.

### Failure injection

```
POST   /stub/failures   { "key": "C-1", "status": 409, "delayMs": 0 }
GET    /stub/failures
DELETE /stub/failures            clear every failure
DELETE /stub/failures/:key       clear one
```

Keyed on one identifier the caller already sends, consumed by one matching call. The
default status is `500`, because a failure should fail; `times` defaults to `1`.

The key is read from the first of: header `x-stub-key`, `?key=`, `body.key`. A preset can
say where its partner puts it instead — see [presets](#presets). `merchantID` is accepted
as an alias so a collection written against the older stub keeps working.

A failure beats a rule: a rule describes an endpoint, a failure describes one call that
must go wrong.

### The recorder

```
GET    /stub/requests[?path=<fragment>]
DELETE /stub/requests
```

Every request, with method, path, query, headers, body, time, the status it was answered
with, and the id of the rule that answered — including 404s.

---

## Sessions

Two test runs can share one container without seeing each other's rules. A rule carrying a
`sessionId` answers only requests carrying the matching header:

```bash
curl -s -H 'x-stub-session: checkout-run-7' localhost:4010/v2/customers/C-1
```

A scoped rule is invisible to a request without the header — it does not fall through and
match anyway. Clean up one run without touching the others:

```bash
curl -sX DELETE 'localhost:4010/stub/rules?sessionId=checkout-run-7'
curl -sX DELETE 'localhost:4010/stub/requests'
```

---

## Endpoints

| Endpoint | What it does |
|---|---|
| `POST /stub/rules` | install a rule; answers `201` with the normalised rule |
| `GET /stub/rules[?sessionId=]` | what is installed, in match order |
| `DELETE /stub/rules[?sessionId=]` | remove every rule, or one run's |
| `DELETE /stub/rules/:id` | remove one |
| `POST /stub/failures` | make one call fail |
| `GET /stub/failures` | what is installed |
| `DELETE /stub/failures[/:key]` | clear one, or all |
| `GET /stub/requests[?path=]` | what the application actually sent |
| `DELETE /stub/requests` | clear the recorder |
| `GET /health` | liveness, for a compose healthcheck |

`/stub/*` and `/health` are **never** matched by a rule. A rule of `*` would otherwise
swallow the endpoint that removes it, and the way out of a bad rule would be a restart.

Responses that came from a rule carry `x-stub-rule: <rule id>`, and the recorder entry
records the same id, so nobody mistakes a fixture for the partner's answer.

---

## Presets

A preset is a partner this stub was told about: a route, its fixtures, and where that
partner puts its identifier. It is data plus, at most, a thin controller, and it lives in
**your** repository.

**This package ships no presets.** A team that only has example responses never needs one.

```ts
import { Controller, Get, Param } from '@nestjs/common';
import { definePreset } from '@rmc/stubbing';

@Controller('acme/orders')
class AcmeOrdersController {
  @Get(':id')
  get(@Param('id') id: string) {
    return { id, status: 'CONFIRMED', totalMinor: 129900 };
  }
}

export const acmePreset = definePreset({
  name: 'acme',
  controllers: [AcmeOrdersController],
  // Only the preset knows where its partner sends the key.
  keyOf: (request) =>
    typeof request.query.customerRef === 'string' ? request.query.customerRef : undefined,
});
```

```bash
npx stub-server --preset ./dist/acme.preset.js
# or a container built on top of this image:
docker run -e STUB_PRESETS=/presets/acme.preset.js -p 4010:4010 rmc/stubbing:1
```

The seam is the point: **adding a route must not require touching `core/`.** If it does,
core knows too much. [`test/preset-seam.spec.ts`](test/preset-seam.spec.ts) mounts a preset
through the public API and proves a route, a failure key and a rule override all work
without a core change. A fictional-but-compiling example is in
[`examples/custom-preset`](examples/custom-preset); `npm run typecheck:examples` keeps it
honest.

---

## Embedding

For Node teams, so the stub is a module rather than a second container:

```ts
import { Module } from '@nestjs/common';
import { StubModule } from '@rmc/stubbing';

@Module({ imports: [StubModule.forRoot()] })
export class AppModule {}
```

Or start it programmatically, which is what the test suite does:

```ts
import { startStubServer } from '@rmc/stubbing';

const stub = await startStubServer({ port: 0 });
// ... run against stub.url, assert with stub.app.get(Recorder) ...
await stub.close();
```

Options:

| Option | Default | What it does |
|---|---|---|
| `presets` | `[]` | partners this instance serves |
| `keyOf` | generic readers | replaces where a failure key is read from |
| `acceptMerchantIdAlias` | `true` | accept `merchantID` as a failure key |
| `maxRules` | `200` | rules installed at once; unbounded is a memory leak with an HTTP interface |
| `maxRecorded` | `500` | requests the recorder keeps |

Embedded, the services are injectable for assertions:
`app.get(Recorder)`, `app.get(Rules)`, `app.get(Failures)`.

---

## Rules that do not lie

The stub makes it easy to test **what we assume**, and an assumption is not a fact. Three
rules keep that honest:

1. **A rule carries its source.** `description` names the partner document or the ticket
   it came from. A rule with no source is a guess wearing a test's clothes.
2. **Do not stub what the partner has not described.** If the example response omits a
   field, leave it out rather than inventing a plausible value; the omission is
   information.
3. **Say when it is invented.** `x-stub-rule` on every stubbed response, and the rule id
   in the recorder entry, so nobody mistakes a fixture for the partner's answer.

Nothing enforces rule 1, because a day-one rule often has no citation yet. The staff review
is `GET /stub/rules`: a run where every rule has a `description` is a run that can be
defended.

---

## Getting it into another project

Three ways, all free. Pick one by how many teams will consume it.

### 1. Tarball — a handoff, an offline build, or a feed

```bash
npm pack                         # rmc-stubbing-1.0.0.tgz, built from dist/
# in the consuming project:
npm i ../rmc-stubbing-1.0.0.tgz
```

Good for one team, an air-gapped build, or uploading once to an artifact feed you already
have (Azure Artifacts, Nexus, Artifactory, Verdaccio). The tarball is ~48 kB packed and
carries `dist/`, so the consumer compiles nothing.

### 2. Git dependency — the default for a private repo

```bash
npm i github:<org>/stubbing#v1.0.0
```

```json
{ "dependencies": { "@rmc/stubbing": "github:<org>/stubbing#v1.0.0" } }
```

`dist/` is **not** in git — a build artifact does not belong there — so the package's
`prepare` script compiles it during the install in npm's clone. That is the whole reason
`prepare` exists; without it this route installs a package whose `main` and `bin` point at
files that are not there.

Trade-off: a git dependency is cloned and built on every fresh `npm i`, and needs git,
network and a TypeScript-capable Node. A tarball or a registry avoids that.

### 3. A registry — only when the number of consumers justifies it

Nothing here needs one, but if you decide you want it:

- **GitHub Packages** (free for private packages): add
  `"publishConfig": { "registry": "https://npm.pkg.github.com" }`, set `"private": false`,
  and give consumers an `.npmrc` with
  `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`.
- **Public npm**: the `@rmc` scope has to exist and belong to the org, and `license` has to
  stop being `UNLICENSED`.

Before publishing anywhere, three things:

1. `"private": false` — it is `true` today, so an accidental `npm publish` is refused.
2. Pick a licence.
3. Publish from the tagged commit, so the tarball matches `v1.0.0` and not a working tree.

The container needs none of this: `docker build .` from a clone, or push the image to any
registry you already have (GHCR has a free allowance).

### Releasing

```bash
# 1. bump the version and add a CHANGELOG line that says what broke and why
npm version 1.1.0 --no-git-tag-version
# 2. prove it before the tag exists
npm test && npm run typecheck && npm run build
# 3. tag and push
git commit -am "chore(release): v1.1.0"
git tag -a v1.1.0 -m "v1.1.0"
git push origin master --tags
```

Consumers upgrade by moving the pin — deliberately, which is the point of a tag.

---

## Versioning

The rule format, the failure shape and the recorder are the contract, so **a breaking
change to them is a major bump**. Everything else can move in a minor.

- Tag releases (`v1.2.0`) and consume by pinning:
  `npm i github:<org>/stubbing#v1.2.0`
- [`test/compatibility.spec.ts`](test/compatibility.spec.ts) holds one recorded rule
  document per released minor and answers it. An upgrade that stops honouring a stored
  rule fails here rather than in a consuming team's pipeline. Never edit an entry a
  released version accepted — add a new one.
- [`CHANGELOG.md`](CHANGELOG.md) carries a "what broke and why" line per release.

Nothing here needs a paid registry. A private repo consumed as a git dependency, an image
built locally, CI within the plan's free minutes.

---

## Development

```bash
npm install
npm test              # 102 tests: the rule engine, the seam, and the whole thing over a socket
npm run typecheck
npm run typecheck:examples
npm run build         # dist/, with the bin at dist/bin.js
npm start             # run the built server on :4010
```

Layout — the split that matters:

```
src/core/        knows nothing about any partner
  dynamic/       the rule engine            /stub/rules
  recorder/      the recorder               /stub/requests
  failures/      failure injection          /stub/failures  (generic `key`)
  health/        /health                    the one fixture core may keep
src/app/         the NestJS module and the container entry point
src/compat/      `merchantID` as a failure key — a shim, deletable in a major
```

`core/` contains no partner's route, field name or fixture. If you are about to add one,
the thing you want is a preset.

---

## Known gaps

- **Auth is not implemented.** [Open question 4](docs/contract-v1.md#8-open-questions) in
  the plan: should the stub be able to require a token so a team tests its own auth path?
  Not yet — a stub that rejects a request for the wrong reason is worse than one that
  records it.
- **Presets are not hot-reloaded.** `STUB_PRESETS` and `--preset` are read at startup.
- **One process, one tenant.** Rules live in memory; use `sessionId` to share an instance,
  not to share a production one.
