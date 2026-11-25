import 'reflect-metadata';

/**
 * The stub server, as this repository builds it.
 *
 * This is not what npm publishes: the package is the CLI (`dist/cli`), and the server
 * is the image. Both come from this source tree, which is why the rule engine here and
 * the runtime in the container cannot drift apart.
 *
 * The rule shape, the failure shape and the recorder are the contract. Everything else
 * may move.
 */

export { StubModule } from './app/stub.module';
export {
  createStubServer,
  startStubServer,
  loadPreset,
  logBanner,
} from './app/container';
export type { StubServerOptions, RunningStub } from './app/container';
export { seedMocks } from './app/mocks';
export type { SeedOptions, SeedResult } from './app/mocks';

export type { StubModuleOptions } from './core/stub-options';
export {
  DEFAULT_MAX_RECORDED,
  DEFAULT_MAX_RULES,
  MAX_DELAY_MS,
} from './core/stub-options';

export { Rules, STUB_RULES } from './core/dynamic/rules.service';
export type { RuleStore } from './core/dynamic/rules.service';
export { Failures, STUB_FAILURES } from './core/failures/failures.service';
export type { FailureStore } from './core/failures/failure.types';
export { Recorder, STUB_RECORDER } from './core/recorder/recorder.service';
export type { RecordedRequest } from './core/recorder/recorder.service';

export { KEY_HEADER, RULE_HEADER, SESSION_HEADER } from './core/constants';
export { matchesRequest, pathMatches } from './core/dynamic/match-request';
export { composeKeyExtractors, defaultKeyOf } from './core/failures/key-source';
export type { KeyExtractor, KeyRequest } from './core/failures/key-source';
export { definePreset } from './core/preset.types';
export type { StubPreset } from './core/preset.types';

/**
 * Compatibility: `merchantID` as a failure key. Exported so a caller can keep it when
 * wiring its own `keyOf`, or drop it deliberately.
 */
export { merchantIdAliasKeyOf } from './compat/merchant-id';

export type {
  IncomingRequest,
  RuleCommon,
  RuleRequestMatch,
  RuleResponseSpec,
  StubRule,
  StubRuleInput,
  StubRuleInputFlat,
  StubRuleInputLong,
} from './core/dynamic/rule.types';
export type {
  StubFailure,
  StubFailureInput,
} from './core/failures/failure.types';
