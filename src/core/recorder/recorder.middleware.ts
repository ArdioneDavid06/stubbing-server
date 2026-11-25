import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { RULE_HEADER, isManagementPath } from '../constants';
import { Recorder } from './recorder.service';

/**
 * Records every request, including the ones no route matched.
 *
 * A 404 is the most useful thing this stub can record: it means the application is
 * calling a path the partner does not serve, which in production is a silent failure
 * with a plausible-looking timeout.
 *
 * The record is written at arrival, then annotated when the answer finishes. That is
 * how `GET /stub/requests` can say which rule answered and with what status without
 * the middleware having to know how the request will be answered.
 */
@Injectable()
export class RecorderMiddleware implements NestMiddleware {
  constructor(private readonly recorder: Recorder) {}

  use(req: Request, res: Response, next: NextFunction): void {
    if (isManagementPath(req.originalUrl)) {
      next();
      return;
    }

    const stored = this.recorder.record({
      method: req.method,
      path: req.path,
      query: req.query as Record<string, unknown>,
      originalPath: req.originalUrl,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([name, value]) => [
          name,
          Array.isArray(value) ? value.join(',') : String(value ?? ''),
        ]),
      ),
      body: req.body ?? null,
    });

    res.on('finish', () => {
      stored.responseStatus = res.statusCode;

      const ruleId = res.getHeader(RULE_HEADER);

      if (typeof ruleId === 'string') {
        stored.ruleId = ruleId;
      }
    });

    next();
  }
}
