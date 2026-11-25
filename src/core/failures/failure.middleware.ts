import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { answer } from '../answer';
import { isManagementPath } from '../constants';
import { STUB_OPTIONS } from '../stub-options';
import type { ResolvedStubOptions } from '../stub-options';
import { STUB_FAILURES } from './failures.service';
import type { FailureStore } from './failure.types';
import { normaliseHeaders } from '../headers';

/**
 * A failure beats a path rule.
 *
 * The two are installed for different reasons: a rule describes an endpoint, a failure
 * describes one call that must go wrong. When both could answer, the narrower intent
 * wins, so a broad rule installed earlier in the run cannot hide a 409 a test just
 * asked for. When the failure is consumed, the next call falls through to the rule.
 */
@Injectable()
export class FailureMiddleware implements NestMiddleware {
  constructor(
    @Inject(STUB_FAILURES) private readonly failures: FailureStore,
    @Inject(STUB_OPTIONS) private readonly options: ResolvedStubOptions,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    if (isManagementPath(req.originalUrl)) {
      next();
      return;
    }

    const key = this.options.keyOf({
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      headers: normaliseHeaders(req.headers),
      body: req.body ?? null,
    });

    if (key === undefined) {
      next();
      return;
    }

    const failure = this.failures.take(key);

    if (!failure) {
      next();
      return;
    }

    await answer(_res, failure);
  }
}
