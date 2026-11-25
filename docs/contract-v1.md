# The contract, v1

**Version:** 1.0.0 · **Status:** stable · **Audience:** teams that store a rule

Three shapes are the API: the rule, the failure, and the recorder entry. Everything else
may change in a minor. A change to anything in this document is a **major** bump, because
a rule is a document a team pastes into a wiki and stores in a pipeline.

---

## 1. A rule

### 1.1 The flat shape

What someone writes by hand.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `method` | string | `*` | `GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`, `OPTIONS` or `*`. Case-insensitive |
| `path` | string | **required** | `/`-absolute; `:name` matches one segment, `*` matches anything including `/` |
| `status` | integer 100–599 | `200` | status of the answer |
| `headers` | object of strings | — | **response** headers |
| `body` | any JSON | — | **the answer**, not the body to match |
| `delayMs` | integer 0–600000 | `0` | stall before answering |
| `name` | string ≤ 200 | — | a label, echoed by `GET /stub/rules` |
| `description` | string ≤ 1000 | — | where the rule came from: the partner document or the ticket |
| `sessionId` | string 1–200 | — | scopes the rule to one run |
| `times` | integer ≥ 0 | `0` | calls it answers; `0` means until deleted |

The flat shape matches on method and path only. To narrow on a query parameter, a header
or a request body, use the long shape — a flat `body` already means the answer, and a rule
where `body` could mean either would be a rule nobody can read.

### 1.2 The long shape

The same rule, narrow enough to answer one call inside a family.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `request` | object | **required** | what the call must be |
| `request.method` | string | `*` | as above |
| `request.path` | string | **required** | as above |
| `request.query` | object of strings | — | every named parameter must be present and equal |
| `request.headers` | object of strings | — | lower-case names; a value wrapped in slashes is a regular expression |
| `request.body` | any JSON | — | matched as a subset: objects may omit fields, arrays must match exactly |
| `response` | object | `{status: 200}` | `status`, `headers`, `body`, `delayMs` as above |
| `name` | string ≤ 200 | — | as above |
| `description` | string ≤ 1000 | — | as above |
| `sessionId` | string 1–200 | — | as above |
| `times` | integer ≥ 0 | `0` | as above |

### 1.3 Which shape a document is

A document is **long** if it has `request`, **flat** if it has `path`, and it may not have
both. Mixing them is `400` with a message naming the fields that did it, because a
document where `body` could be the answer *or* the matcher has no single meaning.

### 1.4 What `GET /stub/rules` returns

The normalised long shape, plus:

| Field | Meaning |
|---|---|
| `id` | server-assigned; stable for the rule's life; echoed as `x-stub-rule` |
| `form` | `"flat"` or `"long"`, so a wiki page can be read back into the shape it was written in |
| `remaining` | calls left; `0` means unlimited |
| `createdAt` | ISO 8601 |

### 1.5 Matching

- Every field present in the rule must match. An omitted field matches anything.
- The **first installed matching rule wins**. Order is the only thing a caller can see, so
  a rule installed to override another can win.
- A rule with `times` is consumed **after** it matches: a call that misses does not spend
  its budget.
- A rule with `sessionId` matches only when the request carries `x-stub-session` with that
  exact value. It is invisible, not merely lower-priority, to other runs.

### 1.6 Answering

- `status` first, then headers, then body.
- An object or array body is sent as JSON. A string is `text/plain` unless the rule set a
  `content-type` header. An absent body is an empty response.
- `delayMs` is applied **before** the status, so a rule with `{ "delayMs": 12000 }` produces
  a real timeout rather than an instant answer the caller never had a chance to give up on.
- `x-stub-rule: <id>` is set on every answer a rule produced.

### 1.7 Refusals

| Situation | Answer |
|---|---|
| invalid rule | `400` with `{ "message": "<all problems, joined>", "errors": ["…"] }` |
| rule limit reached | `400`, naming the limit |
| deleting an unknown rule id | `404` |

---

## 2. Failure injection

### 2.1 Installing

`POST /stub/failures`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `key` | string 1–200 | **required** | the identifier to fail on |
| `merchantID` | string | — | legacy alias for `key`; accepted, not documented for new code |
| `status` | integer 100–599 | `500` | the status to answer with. A failure with no status is not a no-op |
| `body` | any JSON | — | sent as the answer body, so a reason can be asserted |
| `headers` | object of strings | — | e.g. `retry-after` |
| `delayMs` | integer 0–600000 | `0` | pair with `status: 200` to provoke a timeout |
| `times` | integer ≥ 0 | `1` | calls it fails; `0` means unlimited |

Installing a second failure for the same key **replaces** it. A setup step run twice fails
one call, not two.

### 2.2 Where the key is read from

In order, first non-empty wins:

1. a preset's `keyOf`, when one is installed and returns a value
2. header `x-stub-key`
3. `?key=`
4. `body.key`
5. `body.merchantID` / `?merchantID=` — the legacy alias, on by default

A caller that sets `keyOf` replaces step 2–4; step 5 is controlled separately by
`acceptMerchantIdAlias`.

### 2.3 Consuming, and precedence

- A failure is consumed by one matching call (`times` can raise that).
- A failure **beats a rule**: a rule describes an endpoint, a failure describes one call
  that must go wrong. Once the failure is spent, the next call falls through to the rule.

### 2.4 Reading and clearing

| Endpoint | Answer |
|---|---|
| `GET /stub/failures` | `{ "<key>": { key, status, delayMs, body?, headers?, remaining, createdAt } }` |
| `DELETE /stub/failures` | `{ "cleared": <count> }` |
| `DELETE /stub/failures/:key` | `{ "cleared": "<key>" }`, or `404` when absent |

---

## 3. The recorder

`GET /stub/requests[?path=<fragment>]` returns an array, oldest first. `?path=` keeps only
entries whose path contains the fragment.

| Field | Type | Meaning |
|---|---|---|
| `sequence` | integer | 1-based, in arrival order — assert on this, not on timestamps |
| `method` | string | as received |
| `path` | string | path without the query string |
| `originalPath` | string | the URL as the caller used it, query included |
| `query` | object | as received; a repeated parameter is an array |
| `headers` | object of strings | lower-case names, repeated values joined with `,` |
| `body` | any | the parsed body, or `null` |
| `receivedAt` | string | ISO 8601, when it arrived |
| `responseStatus` | integer | the status the stub answered with — **404s included** |
| `ruleId` | string? | the rule that answered, absent when no rule did |

`DELETE /stub/requests` clears the log and restarts `sequence` at 1.

---

## 4. Reserved paths

`/stub/*` and `/health` are never answered by a rule and never recorded. A rule of `*`
would otherwise swallow the endpoint that removes it.

---

## 5. Headers this package owns

| Header | Direction | Meaning |
|---|---|---|
| `x-stub-session` | request | scopes a request to a run |
| `x-stub-rule` | response | the id of the rule that answered |
| `x-stub-key` | request | the failure key, when the caller prefers a header |

---

## 6. Limits

| Limit | Default | Configurable |
|---|---|---|
| rules installed | 200 | `maxRules` |
| failures installed | 200 | `maxRules` |
| recorded requests retained | 500 | `maxRecorded` |
| `delayMs` | 600000 | no — longer is a hang, not a test |
| request body | 5 MB | `bodyLimit` (container options) |

---

## 7. What counts as breaking

Major:

- removing or renaming a field in any of the three shapes
- changing a default that a stored rule depends on
- changing matching precedence, or the meaning of `body` in either shape
- changing a reserved path or an owned header

Minor:

- adding an optional field
- adding an endpoint
- adding a preset mechanism, an option, or a limit

The compatibility test in `test/compatibility.spec.ts` holds one recorded document per
released minor and answers it. Add a document when a version first accepts a new shape;
never edit one a released version accepted.

---

## 8. Open questions

Carried from the plan, with their state in v1:

1. **Unauthenticated.** Should the stub be able to require a token, so a team tests its own
   auth path? Not in v1: a stub that rejects a request for the wrong reason is worse than
   one that records it.
2. **Fixture provider format.** Presets return fixture data themselves; there is no
   declarative fixture format yet. The seam (`controllers`, `providers`) does not preclude
   one.
3. **Presets shipping with the package.** No. This package ships none.
4. **Who owns versioning after the first external consumer.** Unresolved; the compatibility
   test and this document are the mechanism that makes it answerable.
