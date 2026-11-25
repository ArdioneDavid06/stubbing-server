import type { Response } from 'express';

/** The minimal shape of an answer: what a rule and a failure both produce. */
export interface Answer {
  status?: number;
  headers?: Record<string, string>;
  body?: unknown;
  delayMs?: number;
}

/**
 * Write an answer, stalling first when asked.
 *
 * The delay is applied before the status so a rule with `{ delayMs: 12000 }` produces
 * a real timeout rather than an instant answer the caller never had a chance to give
 * up on.
 */
export async function answer(res: Response, spec: Answer): Promise<void> {
  if (spec.delayMs !== undefined && spec.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, spec.delayMs));
  }

  for (const [name, value] of Object.entries(spec.headers ?? {})) {
    res.setHeader(name, value);
  }

  res.status(spec.status ?? 200);

  if (spec.body === undefined) {
    res.end();
    return;
  }

  // A string is text unless the rule said otherwise; an object is always JSON.
  if (typeof spec.body === 'string') {
    if (!res.getHeader('content-type')) {
      res.type('text/plain');
    }

    res.send(spec.body);
    return;
  }

  res.json(spec.body);
}
