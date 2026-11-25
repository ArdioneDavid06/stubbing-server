import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { answer } from '../answer';
import { RULE_HEADER, SESSION_HEADER, isManagementPath } from '../constants';
import { normaliseHeaders } from '../headers';
import { STUB_RULES } from './rules.service';
import type { RuleStore } from './rules.service';

/**
 * Answers a request from an installed rule, before Nest's router sees it.
 *
 * Before the router is the whole point: a rule has to be able to answer a path the
 * stub has no route for. A rule that could only shadow an existing handler would fail
 * at the first new third-party endpoint, which is exactly when someone reaches for a
 * rule.
 *
 * The recorder middleware runs first, so a stubbed call still appears in
 * `/stub/requests` with the body the application sent. That matters more for a rule
 * than for a built-in route: the caller invented this endpoint, and the recorded
 * request is how they find out whether the application sent what they assumed.
 */
@Injectable()
export class RuleMiddleware implements NestMiddleware {
  constructor(@Inject(STUB_RULES) private readonly rules: RuleStore) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    if (isManagementPath(req.originalUrl)) {
      next();
      return;
    }

    const session = req.headers[SESSION_HEADER];
    const rule = this.rules.match({
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      headers: normaliseHeaders(req.headers),
      body: req.body ?? null,
      session: Array.isArray(session) ? session[0] : session,
    });

    if (!rule) {
      next();
      return;
    }

    // The rule id on every answer a rule produced: without it, a caller staring at a
    // body has no way to tell a fixture from a rule they installed an hour ago.
    res.setHeader(RULE_HEADER, rule.id);

    await answer(res, rule.response);
  }
}
