# stubbing-server

A stub for third-party APIs, run as a Docker container and driven by a small CLI.

Every integration waits for somebody else — a sandbox that is down, an account nobody
provisioned, a dataset that does not exist yet. The wait is usually not about code. It is
about **an endpoint and an example response** that nobody has written down.

Point a service's third-party base URL at this, give it the example response, and the
integration starts today. Functional tests call your app; your app calls the stub.

**What it is not:** a mock inside a test, a schema validator, or a replacement for the
partner's sandbox. It proves *our* side. It cannot prove theirs.

- [Requirements](#requirements) · [Authentication](#authentication) · [Quick start](#quick-start) · [Configuration](#configuration) · [CLI](#cli) · [CI/CD](#cicd-integration) · [The rule contract](docs/contract-v1.md)

---

## Architecture

```text
  consuming repository                         this repository
  ──────────────────────                       ─────────────────
  stubbing.config.json  ─┐                     push tag vX.Y.Z
  stubs/*.json          ─┤                            │
                         │                     GitHub Actions
              npx stubbing-server                      ├──► GHCR image
                         │                     ghcr.io/<org>/stubbing-server:X.Y.Z
                         │                            │
                         ▼                            │
                   Docker Engine ─── pulls ───────────┘
                         │
                 ┌───────┴────────┐
                 │  stubbing      │  rules · failures · recorder · /health
                 │  server:4010   │  seeded from stubs/*.json at startup
                 └───────┬────────┘
                         │ HTTP
                 ┌───────┴────────┐
                 │  the app under │
                 │  test          │
                 └────────────────┘
```

Two artifacts, one version: the npm package is **only the CLI** (it never contains the
server), and the image is **only the runtime**. The CLI's job is to make the container
boring to start: check Docker, pull the right tag, mount the rules, wait for `/health`,
and say what went wrong when it does not.

---

## Requirements

| | |
|---|---|
| Node.js | 20 or newer — for the CLI only |
| Docker | Docker Desktop or the Docker Engine, running |
| GitHub access | a token that can read the package and the image; see below |

Nothing else. No database, no Redis, no credentials, no paid registry.

---

## Authentication

The org and the token are two different questions, and both come from GitHub.

### The org

It is the **owner of the repository path**: for `github.com/acme/stubbing-server`, the org
is `acme`, and the npm scope must be `@acme`. For a personal repository the owner is your
username, lowercased.

Everything here is derived from that one value:

| Thing | Value |
|---|---|
| npm package | `@<org>/stubbing-server` |
| image | `ghcr.io/<org>/stubbing-server:<version>` |
| registry to publish to | `https://npm.pkg.github.com` |

The first published release lives under a **personal account**, `@ardionedavid06`, because
the target org (`Foodgroup-IT`) does not yet grant repository-creation rights. Moving it is
mechanical: transfer the repository, change the package name and `DEFAULT_IMAGE` in
[`src/cli/config/defaults.ts`](src/cli/config/defaults.ts), then release again under the new
scope. GitHub Packages requires the scope to equal the repository owner, so the two always
move together — the publish workflow refuses to run when they disagree.

### The token

**For a developer's machine** — one classic personal access token covers both npm and
Docker:

1. GitHub → your avatar → **Settings** → **Developer settings** → **Personal access
   tokens** → **Tokens (classic)** → **Generate new token (classic)**.
2. Scopes: **`read:packages`**. Add **`repo`** only if the repository is private and the
   token also has to read it.
3. Put it in a user-level `.npmrc` — never in a repository:

   ```ini
   @ardionedavid06:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
   ```

   ```bash
   export GH_PACKAGES_TOKEN=ghp_...        # or setx on Windows
   ```

4. Log Docker in once, for the image:

   ```bash
   echo "$GH_PACKAGES_TOKEN" | docker login ghcr.io -u <your-username> --password-stdin
   ```

Fine-grained tokens work too: give **Packages: read** for the org, and ask the org owner
to approve it if the org enforces SSO or token approval.

**For CI** — there is no token to create. `secrets.GITHUB_TOKEN` exists in every run;
the only thing a workflow has to do is ask for permission:

```yaml
permissions:
  contents: read
  packages: read   # write, in the repository that publishes
```

Publishing needs `packages: write`; consuming needs `packages: read`, plus access for the
consuming repository to the package (GitHub → org → Packages → the package → **Manage
access**).

Two registries, two logins. An npm login does **not** authenticate Docker: if the CLI can
start the container but `pull` is refused, the Docker login is the one that is missing.

---

## Quick start

The repository, the container image and the release tarball are public, so the CLI
installs with no token, no registry configuration and no `docker login`. Fastest, because
it is already built:

```bash
npm i -D https://github.com/ArdioneDavid06/stubbing-server/releases/download/v1.0.0/ardionedavid06-stubbing-server-1.0.0.tgz
```

Same thing from the tag, which builds once on install and needs git:

```bash
npm i -D "git+https://github.com/ArdioneDavid06/stubbing-server.git#v1.0.0"
```

Pin the tag, not `master`: two installs a week apart should be the same tool.

The package is also on GitHub Packages. It is faster to install, but it **always needs a
token** — even though the package is public. That is how GitHub's npm registry works; the
container, by contrast, pulls anonymously.

```ini
# ~/.npmrc
@ardionedavid06:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GH_PACKAGES_TOKEN}
```

```bash
npm i -D @ardionedavid06/stubbing-server@1.0.0
```

`GH_PACKAGES_TOKEN` is any token with `read:packages` — `gh auth token` works. Public
visibility decides *who* may read (any GitHub account), not *whether* a token is needed,
which is measured rather than assumed: `npm view` answers with a token and returns 401
without one, while the same release pulls from `ghcr.io` with no credentials.

`stubbing.config.json` next to the consuming project's `package.json`:

```json
{
  "image": "ghcr.io/ardionedavid06/stubbing-server",
  "imageTag": "1.0.0",
  "containerName": "orders-e2e-stub",
  "port": 4010,
  "mocksPath": "./stubs"
}
```

`stubs/partner.json` — the rules, seeded at startup:

```json
[
  {
    "method": "GET",
    "path": "/v2/customers/:id",
    "status": 200,
    "body": { "id": "C-1", "name": "Ada", "tier": "GOLD" },
    "description": "partner docs, GET /v2/customers/{id}"
  },
  {
    "method": "GET",
    "path": "/v2/customers/missing",
    "status": 404,
    "body": { "error": "CUSTOMER_NOT_FOUND" },
    "times": 1,
    "description": "ticket INT-214"
  }
]
```

Optional `stubs/failures.json`:

```json
[{ "key": "C-9", "status": 409, "body": { "error": "TOO_SOON" } }]
```

Point the app at it — the only change in application code:

```dotenv
PARTNER_BASE_URL=http://127.0.0.1:4010
```

Run it:

```bash
npx stubbing-server start
# stubbing-server is up (started)
#   url    http://127.0.0.1:4010
#   image  ghcr.io/ardionedavid06/stubbing-server:1.0.0
#   mocks  /repo/stubs

curl -s localhost:4010/v2/customers/C-1     # {"id":"C-1","name":"Ada","tier":"GOLD"}

npx stubbing-server stop
```

The decisions a stub makes are documented in [docs/contract-v1.md](docs/contract-v1.md):
the two rule shapes, failure injection, the recorder, and what counts as a breaking change.

---

## Configuration

Precedence: **CLI options > project config > defaults**. Relative paths resolve from the
**config file's** directory, so the file means the same thing in every subdirectory.

| Key | Default | Meaning |
|---|---|---|
| `image` | `ghcr.io/ardionedavid06/stubbing-server` | repository, no tag |
| `imageTag` | the CLI version | immutable version; `latest` is refused |
| `containerName` | `stubbing-server` | the one container this CLI manages |
| `host` | `127.0.0.1` | host interface; local by default |
| `port` | `4010` | host port tests talk to |
| `containerPort` | `4010` | port the server listens on inside |
| `healthcheck.path` | `/health` | probed until it answers |
| `healthcheck.timeoutMs` | `60000` | give up here, and print the logs |
| `healthcheck.intervalMs` | `500` | time between probes |
| `mocksPath` | — | `*.json` rules mounted read-only at `/stubs` and seeded |
| `environment` | `{}` | extra container environment; never logged |
| `pull` | `missing` | `missing`, `always`, `never` |

Unknown keys are errors, not ignored: a typo that silently starts the stub on the default
port costs more than the message that names it.

`mocksPath` seeding rules:

- every `*.json` in the directory is one rule or an array of rules;
- `failures.json` is an array of failures instead;
- every entry goes through the same validation `POST /stub/rules` uses;
- a bad entry stops the container **before the port opens**, with `file[index]` in the
  message — better than a stub that answers 404 to everything and looks healthy.

---

## CLI

```text
stubbing-server <command> [options]

start      start the container, or reuse the one already running
stop       stop the container this tool manages
status     state, image, port, url, health
logs       the container's output (--follow to stream)
pull       pull the configured image
version    the CLI, the image, and the image's own version
```

| Option | Applies to | Meaning |
|---|---|---|
| `-c, --config <path>` | all | config file (default `./stubbing.config.json`) |
| `-p, --port <port>` | start | host port |
| `--host <host>` | start | host interface |
| `--name <name>` | start, stop, status, logs | container name |
| `--image <ref>` / `--image-tag <tag>` | start, pull | image selection |
| `--timeout <ms>` | start | health wait |
| `--pull` / `--no-pull` | start | force or forbid a pull |
| `--remove` | stop | remove the container too |
| `-f, --follow` / `--tail <n>` | logs | stream / last N lines |
| `-h, --help`, `-v, --version` | | |

**Exit codes** — a pipeline can branch on these:

| Code | Meaning |
|---|---|
| 0 | the command did what it said |
| 1 | it could not: Docker down, image missing, port taken, health never came up |
| 2 | the request was impossible: bad flag, bad config, `latest` tag |

Behaviour worth knowing:

- `start` **reuses** a running container, **starts** a stopped one, and **refuses** one
  built from another image or publishing another port — rather than silently replacing
  a container that may be another repository's.
- `stop` only touches a container this tool created (by label) and is idempotent.
- Labels: `com.foodgroup.stubbing.managed`, `com.foodgroup.stubbing.project`,
  `com.foodgroup.stubbing.version`. That is how "unrelated containers are never touched" is
  enforced rather than promised.
- Docker is invoked as an argument array, never through a shell.

---

## Local development workflow

In a consuming repository, two scripts are enough (add them to its `package.json`):

```json
{
  "scripts": {
    "stub:up": "stubbing-server start --config ./stubbing.config.json",
    "stub:down": "stubbing-server stop"
  }
}
```

```bash
npm run stub:up        # starts the container, seeds stubs/, waits for /health
npm test               # functional suite hits the app, the app hits the stub
npm run stub:down
```

One container serves every suite in a run. Two ways to keep suites from colliding:

- `sessionId` on a rule + the `x-stub-session` header scopes it to one run;
- `times` on a rule consumes it after N calls.

Tear down between tests over HTTP:

```ts
const STUB = process.env.PARTNER_BASE_URL!;

beforeEach(async () => {
  await fetch(`${STUB}/stub/requests`, { method: 'DELETE' });
});

it('a 409 from the partner is not retried as a 500', async () => {
  await fetch(`${STUB}/stub/failures`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'C-1', status: 409 }),
  });

  const res = await request(app.getHttpServer()).post('/checkout').send({ customerId: 'C-1' });
  expect(res.status).toBe(409);

  // The recorder is the assertion a response check cannot make: what did we send?
  const sent = await (await fetch(`${STUB}/stub/requests?path=customers`)).json();
  expect(sent.at(-1).body).toEqual(expect.objectContaining({ customerId: 'C-1' }));
});
```

Warm the image once so the first `start` in a day is not a pull:

```bash
npx stubbing-server pull
```

---

## CI/CD integration

A complete consuming workflow. The `if: always()` is the part that matters: a failing
test must still stop the container.

```yaml
name: e2e

on: [pull_request]

permissions:
  contents: read
  packages: read

jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
          registry-url: https://npm.pkg.github.com
          scope: '@ardionedavid06'

      - name: install, including the CLI from GitHub Packages
        run: npm ci
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: log in to the image registry
        run: echo "${GITHUB_TOKEN}" | docker login ghcr.io -u "${GITHUB_ACTOR}" --password-stdin
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: start the stub
        run: npx stubbing-server start --config ./stubbing.config.json

      - name: integration tests
        run: npm run test:e2e

      - name: stop the stub
        if: always()
        run: npx stubbing-server stop --remove
```

If the consuming repository cannot be granted access to the package, use the image only —
`docker pull` plus `docker run` replaces the CLI, at the cost of writing the `-p`, `-v` and
`-e` flags yourself.

---

## Versioning and upgrading

The CLI and the image share one version, and the release workflow refuses to publish them
out of step.

- Pin both: `"@ardionedavid06/stubbing-server": "1.0.0"` in npm and `"imageTag": "1.0.0"` in the config.
- `latest` is refused by the CLI, because two runs of a moving tag are two different runs.
- Upgrade deliberately: bump both, run the suite, commit. Nothing pulls a new version on
  its own.
- `npx stubbing-server version` prints the CLI version, the configured image, and the
  image's own OCI version label, so "which one am I actually running" has an answer.

---

## Releasing (maintainers)

```bash
# 1. bump and describe
npm version 1.1.0 --no-git-tag-version
#    add a CHANGELOG line that says what broke and why
# 2. prove it
npm ci && npm test && npm run typecheck && npm run build
# 3. commit, tag, push
git commit -am "chore(release): v1.1.0"
git tag -a v1.1.0 -m "v1.1.0"
git push origin master --tags
```

[`publish.yml`](.github/workflows/publish.yml) then: checks the tag matches `package.json`,
runs the suite, builds the image with `VERSION`, proves the image answers a rule, pushes
`ghcr.io/<owner>/stubbing-server:X.Y.Z`, and publishes the npm CLI — skipping the publish
if that version already exists, so re-running a release is safe.

An admin must configure, once:

| Setting | Where |
|---|---|
| Package visibility (private) | org → Packages → `stubbing-server` → settings |
| Which repositories may read it | org → Packages → `stubbing-server` → **Manage access** |
| Actions allowed to write packages | repo → Settings → Actions → General → Workflow permissions |
| SSO / token approval, if enforced | org → Settings → Personal access tokens |

No token is committed anywhere, and none is needed in CI beyond `GITHUB_TOKEN`.

---

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `the docker command was not found` | Docker is not installed, or not on `PATH` |
| `Docker is not usable` / daemon detail | Docker Desktop is not running |
| `could not pull … 401` | `docker login ghcr.io` is missing, or the token lacks `read:packages` |
| `port 4010 … already in use` | stop the other process, or `--port 4011` |
| `did not answer /health within 60000ms` | the container printed why; the CLI prints its last 20 lines too. `logs` has the rest |
| `container … already exists: … built from` | the name is reused with another image; `stop --remove`, then `start` |
| `was not created by this CLI` | a container with that name exists but is not ours; choose another `--name` |
| `unknown key "prot"` | a typo in the config; the message names it rather than guessing |
| `"imageTag" must pin a version` | replace `latest` with a real version |
| `npm i` gets 404 from GitHub Packages | wrong scope, or the token lacks `read:packages`, or the repo is not on the package's access list |

---

## Security

- The image runs as **non-root** (`node`) and contains production dependencies only.
- The CLI binds to `127.0.0.1` by default. A stub is a development tool; publishing it on
  `0.0.0.0` is a deliberate act, not a default.
- The mocks directory is mounted **read-only**: a run cannot rewrite the rules a reviewer
  approved.
- No secrets in the repository, the tarball, the image layers, or the log lines: the CLI
  never prints `environment` values.
- Docker receives argument arrays, never an interpolated command line.
- The management API (`/stub/*`) is unauthenticated by design; keep the port private.
- Stub data is test data. Never point the stub at a production partner's credentials.

---

## GitHub plan usage

Publishing here uses GitHub Packages and GHCR, which are metered per plan, and Actions
minutes, which are metered too. Limits and overage billing change, so check the current
numbers rather than trusting a number written here: GitHub's *About billing for GitHub
Packages* and *About billing for GitHub Actions* pages are the source of truth.

What keeps usage small regardless of plan:

- the npm package is ~42 kB, and only the CLI;
- one image per release, tagged by version, no per-branch images;
- CI runs on pull requests and tags only — no nightly builds;
- consumers pull the image once per job, and Actions caches are enabled in the workflows
  here (`cache: npm`).

If the org approaches its limits, the cheapest lever is fewer release tags, then artifact
retention — not a paid registry.

---

## This repository

```text
src/core/        the rule engine, recorder, failures, health — no partner's vocabulary
src/app/         the NestJS module, the container bootstrap, mocks seeding
src/cli/         the CLI: commands, config, docker client, health wait
src/compat/      `merchantID` as a failure key — a shim, deletable in a major
src/bin.ts       the server entry point, and the image's CMD
examples/        a day-one script, and the shape of a preset
```

The published npm package is `dist/cli` only; the image is the server. A partner that needs
its own routes adds a **preset** (see [`examples/custom-preset`](examples/custom-preset)) and
builds its own image from this repository — presets are code, so they cannot ride along in
a 42 kB CLI.

```bash
npm install
npm test                 # 178 tests: the rule engine, the CLI, and the seam
npm run typecheck
npm run typecheck:examples
npm run build
npm start                # the server on :4010, without Docker
npm run dev:cli -- version
```

## Rules that do not lie

The stub makes it easy to test **what we assume**, and an assumption is not a fact:

1. **A rule carries its source.** `description` names the partner document or the ticket.
   A rule with no source is a guess wearing a test's clothes.
2. **Do not stub what the partner has not described.** If the example response omits a
   field, leave it out; the omission is information.
3. **Say when it is invented.** `x-stub-rule` on every stubbed response, and the rule id in
   the recorder entry, so nobody mistakes a fixture for the partner's answer.
