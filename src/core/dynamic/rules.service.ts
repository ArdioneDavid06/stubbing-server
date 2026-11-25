import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { asRecord } from '../failures/key-source';
import { DEFAULT_MAX_RULES, MAX_DELAY_MS, STUB_OPTIONS } from '../stub-options';
import type { ResolvedStubOptions } from '../stub-options';
import { headerMatcher, matchesRequest } from './match-request';
import type {
  IncomingRequest,
  RuleRequestMatch,
  RuleResponseSpec,
  StubRule,
} from './rule.types';

/** Injection token, so callers depend on the store shape rather than this class. */
export const STUB_RULES = 'STUB_RULES';

/** What the middleware and the controller need from the registry. */
export interface RuleStore {
  add(input: unknown): StubRule;
  list(sessionId?: string): StubRule[];
  clear(sessionId?: string): number;
  remove(id: string): boolean;
  match(request: IncomingRequest): StubRule | undefined;
}

const METHODS = new Set([
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
]);

const RULE_KEYS = new Set([
  'name',
  'description',
  'sessionId',
  'times',
  'method',
  'path',
  'status',
  'headers',
  'body',
  'delayMs',
  'request',
  'response',
]);

/** Fields that only the flat shape has; seeing one next to `request` is a mixed rule. */
const FLAT_KEYS = [
  'method',
  'path',
  'status',
  'headers',
  'body',
  'delayMs',
] as const;

const REQUEST_KEYS = new Set(['method', 'path', 'query', 'headers', 'body']);
const RESPONSE_KEYS = new Set(['status', 'headers', 'body', 'delayMs']);

const MAX_SESSION_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 1000;

/**
 * The rules installed through `POST /stub/rules`.
 *
 * Each rule describes a call and the answer it should get. The middleware consults
 * this registry before Nest's router, so a rule can cover a path the stub has no
 * route for - the usual reason to want one - and can override a route it does have.
 *
 * Rules live as long as the process unless they are installed with `times`, which
 * counts down and removes the rule after the last call it answers. A rule that
 * stayed forever after one use would fail a later case in the same run for a reason
 * that has nothing to do with that case.
 */
@Injectable()
export class Rules implements RuleStore {
  private readonly rules = new Map<string, StubRule>();

  constructor(
    @Optional()
    @Inject(STUB_OPTIONS)
    private readonly options?: ResolvedStubOptions,
  ) {}

  /** Validate and install a rule. Throws 400 with every problem it found. */
  add(input: unknown): StubRule {
    const candidate = asRecord(input);

    if (!candidate) {
      throw invalid(['the body must be an object']);
    }

    const errors: string[] = [];

    rejectUnknownKeys(candidate, RULE_KEYS, 'body', errors);

    const hasRequest = 'request' in candidate;
    const flatKeysPresent = FLAT_KEYS.filter((key) => key in candidate);

    if (hasRequest && flatKeysPresent.length > 0) {
      throw invalid([
        `a rule is either flat (${flatKeysPresent.join(', ')}) or long (request/response), not both; ` +
          'move the answer into `response` to keep the long form',
      ]);
    }

    if (!hasRequest && flatKeysPresent.length === 0) {
      throw invalid([
        'a rule needs `path` (flat form) or `request.path` (long form)',
      ]);
    }

    const form: StubRule['form'] = hasRequest ? 'long' : 'flat';

    const request =
      form === 'long'
        ? validateRequest(candidate.request, errors)
        : validateFlatRequest(candidate, errors);

    const response =
      form === 'long'
        ? validateResponse(candidate.response, errors)
        : validateFlatResponse(candidate, errors);

    const times = candidate.times ?? 0;

    if (typeof times !== 'number' || !Number.isInteger(times) || times < 0) {
      errors.push('times must be a whole number of calls, 0 for unlimited');
    }

    const sessionId = validateSessionId(candidate.sessionId, errors);
    const name = validateText(candidate.name, 'name', 200, errors);
    const description = validateText(
      candidate.description,
      'description',
      MAX_DESCRIPTION_LENGTH,
      errors,
    );

    if (errors.length > 0) {
      throw invalid(errors);
    }

    const limit = this.options?.maxRules ?? DEFAULT_MAX_RULES;

    if (this.rules.size >= limit) {
      throw invalid([
        `there are already ${limit} rules installed; delete some first`,
      ]);
    }

    const rule: StubRule = {
      id: randomUUID(),
      ...(name !== undefined ? { name } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(sessionId !== undefined ? { sessionId } : {}),
      form,
      // Both validators above only return a value when they found no errors.
      request: request as RuleRequestMatch,
      response: response as StubRule['response'],
      remaining: times as number,
      createdAt: new Date().toISOString(),
    };

    this.rules.set(rule.id, rule);

    return rule;
  }

  /** Every installed rule, in the order they are tried. Filter by session for one run. */
  list(sessionId?: string): StubRule[] {
    const all = [...this.rules.values()];

    return sessionId === undefined
      ? all
      : all.filter((rule) => rule.sessionId === sessionId);
  }

  /** Remove one rule. Returns false when the id is unknown. */
  remove(id: string): boolean {
    return this.rules.delete(id);
  }

  /**
   * Remove every rule, or only one run's rules, and report how many went.
   *
   * The session-scoped form is what a setup or teardown step calls, so a run that
   * forgot a `times` cannot poison the next one.
   */
  clear(sessionId?: string): number {
    if (sessionId === undefined) {
      const count = this.rules.size;

      this.rules.clear();

      return count;
    }

    let removed = 0;

    for (const [id, rule] of this.rules) {
      if (rule.sessionId === sessionId) {
        this.rules.delete(id);
        removed += 1;
      }
    }

    return removed;
  }

  /**
   * The first rule that matches, or `undefined`.
   *
   * First match wins rather than most-specific, because the order is the only thing a
   * caller can see: a rule installed to override another has to be able to win, and
   * "later wins" cannot express a broad rule that still lets a narrow one through.
   *
   * A session-scoped rule is invisible to a request that does not carry its session,
   * so two tests can share a container without answering each other's calls.
   *
   * A limited rule is consumed here, after it matched, so a call that misses does not
   * spend its budget.
   */
  match(request: IncomingRequest): StubRule | undefined {
    for (const rule of this.rules.values()) {
      if (rule.sessionId !== undefined && rule.sessionId !== request.session) {
        continue;
      }

      if (!matchesRequest(rule.request, request)) {
        continue;
      }

      if (rule.remaining > 0) {
        rule.remaining -= 1;

        if (rule.remaining === 0) {
          this.rules.delete(rule.id);
        }
      }

      return rule;
    }

    return undefined;
  }
}

function validateFlatRequest(
  candidate: Record<string, unknown>,
  errors: string[],
): RuleRequestMatch | undefined {
  const request: Record<string, unknown> = { path: candidate.path };

  if (candidate.method !== undefined) {
    request.method = candidate.method;
  }

  return validateRequest(request, errors, '', false);
}

function validateFlatResponse(
  candidate: Record<string, unknown>,
  errors: string[],
): RuleResponseSpec | undefined {
  const response: Record<string, unknown> = {};

  for (const key of ['status', 'headers', 'body', 'delayMs'] as const) {
    if (key in candidate) {
      response[key] = candidate[key];
    }
  }

  return validateResponse(response, errors, '');
}

function validateRequest(
  value: unknown,
  errors: string[],
  prefix = 'request.',
  strict = true,
): RuleRequestMatch | undefined {
  const request = asRecord(value);

  if (!request) {
    errors.push(
      strict ? 'request must be an object with a path' : 'a path is required',
    );
    return undefined;
  }

  if (strict) {
    rejectUnknownKeys(request, REQUEST_KEYS, 'request', errors);
  }

  if (
    typeof request.path !== 'string' ||
    (request.path !== '*' && !request.path.startsWith('/'))
  ) {
    errors.push(`${prefix}path must be a string starting with / or '*'`);
  }

  if (
    request.method !== undefined &&
    (typeof request.method !== 'string' ||
      (request.method !== '*' && !METHODS.has(request.method.toUpperCase())))
  ) {
    errors.push(
      `${prefix}method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS or *`,
    );
  }

  for (const field of ['query', 'headers'] as const) {
    const value = request[field];

    if (value === undefined) {
      continue;
    }

    const record = asRecord(value);

    if (!record) {
      errors.push(`${prefix}${field} must be an object of strings`);
      continue;
    }

    for (const [key, entry] of Object.entries(record)) {
      if (typeof entry !== 'string') {
        errors.push(`${prefix}${field}.${key} must be a string`);
        continue;
      }

      if (field === 'headers') {
        try {
          headerMatcher(entry);
        } catch {
          errors.push(
            `${prefix}headers.${key} is not a valid regular expression: ${entry}`,
          );
        }
      }
    }
  }

  return request as unknown as RuleRequestMatch;
}

function validateResponse(
  value: unknown,
  errors: string[],
  prefix = 'response.',
): RuleResponseSpec | undefined {
  if (value === undefined) {
    return { status: 200, delayMs: 0 };
  }

  const response = asRecord(value);

  if (!response) {
    errors.push(`${prefix || 'response'} must be an object`);
    return undefined;
  }

  if (prefix) {
    rejectUnknownKeys(response, RESPONSE_KEYS, 'response', errors);
  }

  if (
    response.status !== undefined &&
    (typeof response.status !== 'number' ||
      !Number.isInteger(response.status) ||
      response.status < 100 ||
      response.status > 599)
  ) {
    errors.push(`${prefix}status must be an integer between 100 and 599`);
  }

  if (
    response.delayMs !== undefined &&
    (typeof response.delayMs !== 'number' ||
      !Number.isInteger(response.delayMs) ||
      response.delayMs < 0 ||
      response.delayMs > MAX_DELAY_MS)
  ) {
    errors.push(`${prefix}delayMs must be between 0 and ${MAX_DELAY_MS}`);
  }

  if (response.headers !== undefined) {
    const headers = asRecord(response.headers);

    if (!headers) {
      errors.push(`${prefix}headers must be an object of strings`);
    } else {
      for (const [key, entry] of Object.entries(headers)) {
        if (typeof entry !== 'string') {
          errors.push(`${prefix}headers.${key} must be a string`);
        }
      }
    }
  }

  return {
    status: (response.status as number) ?? 200,
    delayMs: (response.delayMs as number) ?? 0,
    ...(response.headers !== undefined
      ? { headers: response.headers as Record<string, string> }
      : {}),
    ...('body' in response ? { body: response.body } : {}),
  };
}

function validateSessionId(
  value: unknown,
  errors: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string' || value.trim().length === 0) {
    errors.push('sessionId must be a non-empty string');
    return undefined;
  }

  if (value.length > MAX_SESSION_LENGTH) {
    errors.push(`sessionId must be at most ${MAX_SESSION_LENGTH} characters`);
    return undefined;
  }

  return value.trim();
}

function validateText(
  value: unknown,
  field: string,
  limit: number,
  errors: string[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'string') {
    errors.push(`${field} must be a string`);
    return undefined;
  }

  if (value.length > limit) {
    errors.push(`${field} must be at most ${limit} characters`);
    return undefined;
  }

  return value;
}

function rejectUnknownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
  errors: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(`${where}.${key} is not a recognised field`);
    }
  }
}

function invalid(errors: string[]): BadRequestException {
  return new BadRequestException({
    message: errors.join('; '),
    errors,
  });
}
