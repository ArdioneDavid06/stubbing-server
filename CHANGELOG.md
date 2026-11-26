# Changelog

Every release says what broke and why. The rule format, the failure shape and the recorder
are the contract; see [docs/contract-v1.md](docs/contract-v1.md).

## [1.1.0] - 2026-11-26

The package now ships the library as well as the CLI, because a functional suite sometimes
wants the server in its own process rather than in a container.

### Added

- `main`, `types` and `exports` for the package root: `startStubServer`, `createStubServer`,
  `StubModule`, `definePreset`, `seedMocks`, and the injectable `Recorder`, `Rules` and
  `Failures`. A test can start the server on an ephemeral port, seed it from the same JSON
  files the container reads, and assert on the recorder without an HTTP round trip.
- `exports["./cli"]`, so a programmatic caller can reach the CLI entry point.

### Changed

- The tarball is ~87 kB rather than ~44 kB: `files` includes all of `dist`. It installs no
  dependency it did not already install, because the CLI package already declared the Nest
  runtime.
- The CI guard now asserts that both entry points are present and that the test suite is
  not, rather than asserting that no server code is shipped.

### Unchanged

- Every rule, failure and recorder shape. This is a minor release in the sense the contract
  means it: nothing stored has to change.

## [1.0.0] - 2026-11-26

The first release: the stub from Remote's `apps/stub-server`, as one Docker runtime and one
small CLI that starts it.

### Added

- `@ardionedavid06/stubbing-server`, a CLI with six commands — `start`, `stop`, `status`, `logs`,
  `pull`, `version` — and a `stubbing.config.json` per consuming repository. CLI options
  win over the file, the file wins over defaults; relative paths resolve from the config
  file, not the working directory.
- `start` validates Docker, pulls the pinned image, refuses a taken port before running
  anything, waits for `/health` with a configurable timeout, and prints the URL. A timeout
  prints the container's last lines instead of a bare "exit 1".
- Containers are labelled `com.foodgroup.stubbing.managed`, `.project` and `.version`. `stop`
  refuses a container this tool did not create, and a container built from another image
  or publishing another port is a refusal rather than a silent replacement.
- Exit codes are part of the interface: `0` did it, `1` could not, `2` the request was
  impossible.
- `mocksPath`: a directory of `*.json` rules (and `failures.json`) mounted read-only and
  seeded at startup through the same validation `POST /stub/rules` uses. A bad entry stops
  the container before the port opens, with `file[index]` in the message.
- The image carries `org.opencontainers.image.version`, so `stubbing-server version`
  reports the runtime's version rather than the tag someone typed.
- `ci.yml` proves the CLI against a real container on every pull request, and fails if the
  npm tarball ever grows server code. `publish.yml` publishes the image and the CLI from
  one tag, refuses a tag that disagrees with `package.json`, and skips an npm publish that
  already exists.

### Changed

- The npm package is the **CLI only** (`files: ["dist/cli"]`, ~42 kB, no server, no Nest at
  runtime). The server lives in the GHCR image. A team that wants the stub as a library now
  uses this repository, not a published tarball.
- The rule format is unchanged from the implementation this was extracted from: both the
  flat and the long shape are accepted, and both normalise to the same stored rule.
- The failure key is `key`, not `merchantID`. `merchantID` is still accepted, from
  `src/compat/` rather than from core, because it is a partner's word for an identifier —
  not a concept — and core must not carry one.
- Failure injection is one middleware, so it works for any path, including one the stub has
  no route for. A failure beats a path rule: a rule describes an endpoint, a failure
  describes one call that must go wrong.
- The recorder entry carries `responseStatus` and `ruleId`, filled in when the answer
  finishes, so a 404 and the rule that answered are both visible after the fact.

### Deliberately not included

- **No CDH or GrabFood presets.** They are Remote's specifics; this is the thing every team
  gets. Presets remain a seam in this repository, exercised by
  `test/preset-seam.spec.ts`, not a published extension point.
- **No authentication on the management API.** A stub that rejects a request for the wrong
  reason teaches nothing. Bind it to `127.0.0.1`, which the CLI does by default.
- **No Docker SDK.** The CLI shells out with argument arrays, so a container name is never
  a fragment of a command line.

### Deviations from the plan worth naming

- The plan said "the rule id in the body". The body is the partner's answer, and adding a
  field to it would be the kind of invention the honesty rules warn about. The id is on
  `x-stub-rule` and in the recorder entry instead.
- The plan described an embedded module as a second way in. The CLI-plus-image split makes
  the container the only supported way for a consuming team; the module still exists in
  this repository, and is what the tests and the image run.
