import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import type { DynamicModule, Type } from '@nestjs/common';
import { merchantIdAliasKeyOf } from '../compat/merchant-id';
import { HealthController } from '../core/health/health.controller';
import { FailureMiddleware } from '../core/failures/failure.middleware';
import { FailuresController } from '../core/failures/failures.controller';
import { Failures, STUB_FAILURES } from '../core/failures/failures.service';
import {
  composeKeyExtractors,
  defaultKeyOf,
} from '../core/failures/key-source';
import type { KeyExtractor } from '../core/failures/key-source';
import { RecorderMiddleware } from '../core/recorder/recorder.middleware';
import { Recorder, STUB_RECORDER } from '../core/recorder/recorder.service';
import { RequestsController } from '../core/recorder/requests.controller';
import { RuleMiddleware } from '../core/dynamic/rule.middleware';
import { RulesController } from '../core/dynamic/rules.controller';
import { Rules, STUB_RULES } from '../core/dynamic/rules.service';
import {
  DEFAULT_MAX_RECORDED,
  DEFAULT_MAX_RULES,
  STUB_OPTIONS,
} from '../core/stub-options';
import type {
  ResolvedStubOptions,
  StubModuleOptions,
} from '../core/stub-options';

/**
 * The stub, as a NestJS module.
 *
 *   import { StubModule } from '@rmc/stubbing';
 *
 *   @Module({ imports: [StubModule.forRoot()] })
 *   export class AppModule {}
 *
 * `forRoot()` with no arguments serves the rule engine, the recorder and failure
 * injection, which is the whole product for a team that has example responses and no
 * partner-specific code. Presets add a partner's routes without touching core.
 */
@Module({})
export class StubModule implements NestModule {
  static forRoot(options: StubModuleOptions = {}): DynamicModule {
    const presets = options.presets ?? [];

    // Presets are asked first: only a preset knows where its partner puts the key.
    // Then the generic readers, then the legacy name.
    const extractors: KeyExtractor[] = [
      ...presets
        .map((preset) => preset.keyOf)
        .filter(
          (extractor): extractor is KeyExtractor => extractor !== undefined,
        ),
      options.keyOf ?? defaultKeyOf,
      ...(options.acceptMerchantIdAlias === false
        ? []
        : [merchantIdAliasKeyOf]),
    ];

    const resolved: ResolvedStubOptions = {
      presets,
      keyOf: composeKeyExtractors(extractors),
      maxRules: options.maxRules ?? DEFAULT_MAX_RULES,
      maxRecorded: options.maxRecorded ?? DEFAULT_MAX_RECORDED,
    };

    const presetControllers: Type<unknown>[] = presets.flatMap((preset) => [
      ...(preset.controllers ?? []),
    ]);

    return {
      module: StubModule,
      controllers: [
        HealthController,
        RulesController,
        RequestsController,
        FailuresController,
        ...presetControllers,
      ],
      providers: [
        Recorder,
        Rules,
        Failures,
        RecorderMiddleware,
        FailureMiddleware,
        RuleMiddleware,
        { provide: STUB_OPTIONS, useValue: resolved },
        { provide: STUB_RULES, useExisting: Rules },
        { provide: STUB_FAILURES, useExisting: Failures },
        { provide: STUB_RECORDER, useExisting: Recorder },
        ...presets.flatMap((preset) => [...(preset.providers ?? [])]),
      ],
      exports: [
        Recorder,
        Rules,
        Failures,
        STUB_OPTIONS,
        STUB_RULES,
        STUB_FAILURES,
        STUB_RECORDER,
      ],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    // `'*'` does not match in Express 5 - path-to-regexp v8 requires a named
    // wildcard, so the middleware would silently never run.
    //
    // Order matters:
    //   1. the recorder, so a stubbed call still shows up in `/stub/requests`
    //   2. failures, because one call going wrong is narrower than a rule
    //   3. the rules, which get the first refusal on everything else
    consumer
      .apply(RecorderMiddleware, FailureMiddleware, RuleMiddleware)
      .forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
