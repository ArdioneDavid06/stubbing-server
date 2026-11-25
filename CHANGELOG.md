# Changelog

Every release says what broke and why. The rule format, the failure shape and the recorder
are the contract; see [docs/contract-v1.md](docs/contract-v1.md).

## [1.0.0] - 2026-11-26

The first release: the stub from Remote's `apps/stub-server`, extracted as a package that
knows nothing about any partner.

### Added

- `@rmc/stubbing` as an embedded NestJS module (`StubModule.forRoot`) and a standalone
  container (`stub-server`, `--preset`, `Dockerfile`, `docker-compose.stub.yml`).
- The rule format in two shapes — flat (`method`, `path`, `status`, `body`) and long
  (`request`/`response`) — both accepted, both normalised to the long shape.
- `sessionId` on a rule, scoped by the `x-stub-session` header, so two runs can share one
  container. `DELETE /stub/rules?sessionId=` cleans up one run.
- The recorder entry now carries `responseStatus` and `ruleId`, filled in when the answer
  finishes, so a 404 and the rule that answered are both visible after the fact.
- `times` on a failure, defaulting to `1`.
- A preset seam: `definePreset({ name, controllers, providers, keyOf })`. Adding a partner
  route does not touch `core/`; `test/preset-seam.spec.ts` is the proof.
- `test/compatibility.spec.ts`: one recorded rule document per released minor, answered by
  the package's own suite.
- `npm run typecheck:examples`, so `examples/custom-preset` cannot rot.

### Changed

- The failure key is `key`, not `merchantID`. `merchantID` is still accepted, from
  `src/compat/` rather than from core, because it is a partner's word for an identifier —
  not a concept — and core must not carry one.
- Failure injection moved from per-route calls to one middleware, so it works for any path,
  including one the stub has no route for.
- A failure now beats a rule. A rule describes an endpoint; a failure describes one call
  that must go wrong.

### Deliberately not included

- **No CDH or GrabFood presets.** They are Remote's specifics, and this package is the
  thing every team gets. Remote's own routes stay in Remote.
- **No authentication.** A stub that rejects a request for the wrong reason teaches
  nothing; see the open questions in the contract.

### Deviations from the plan worth naming

- The plan said "the rule id in the body". The body is the partner's answer, and adding a
  field to it would be exactly the kind of invention §7 warns about. The id is on
  `x-stub-rule` and in the recorder entry instead.
- Presets are TypeScript/NestJS objects rather than a declarative fixture format. The
  format question (plan §8.2) is still open; the seam does not decide it.
