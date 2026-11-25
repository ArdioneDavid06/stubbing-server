import 'reflect-metadata';

/**
 * `@rmc/stubbing` - a stub server for third-party APIs.
 *
 * Two ways in, one rule format:
 *
 *   standalone   docker run --rm -p 4010:4010 rm/stubbing:1
 *   embedded     imports: [StubModule.forRoot()]
 *
 * The rule shape, the failure shape and the recorder are the contract. Everything
 * else may move.
 */

export { StubModule } from './app/stub.module';
export {
  createStubServer,
  startStubServer,
  loadPreset,
  logBanner,
} from './app/container';
export type { StubServerOptions, RunningStub } from './app/container';

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
