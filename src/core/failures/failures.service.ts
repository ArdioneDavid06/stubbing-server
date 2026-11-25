import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { DEFAULT_MAX_RULES, MAX_DELAY_MS, STUB_OPTIONS } from '../stub-options';
import type { ResolvedStubOptions } from '../stub-options';
import type { FailureStore, StubFailure } from './failure.types';
import { asRecord, readString } from './key-source';

/** Injection token, so callers depend on the store shape rather than this class. */
export const STUB_FAILURES = 'STUB_FAILURES';

const FAILURE_KEYS = new Set([
  'key',
  'merchantID',
  'merchantId',
  'status',
  'body',
  'delayMs',
  'headers',
  'times',
]);

const MAX_KEY_LENGTH = 200;

/**
 * The failures installed through `POST /stub/failures`.
 *
 * Keyed on one identifier rather than on a whole request, because that is the one
 * thing the application already sends on every call. It is the simplest thing that
 * produces a 409 on demand, and it is what most tests actually need.
 */
@Injectable()
export class Failures implements FailureStore {
  private readonly failures = new Map<string, StubFailure>();

  constructor(
    @Optional()
    @Inject(STUB_OPTIONS)
    private readonly options?: ResolvedStubOptions,
  ) {}

  /** Install or replace the failure for one key. Throws 400 with every problem found. */
  add(input: unknown): StubFailure {
    const candidate = asRecord(input);

    if (!candidate) {
      throw invalid(['the body must be an object']);
    }

    const errors: string[] = [];

    for (const key of Object.keys(candidate)) {
      if (!FAILURE_KEYS.has(key)) {
        errors.push(`body.${key} is not a recognised field`);
      }
    }

    const key =
      readString(candidate.key) ??
      readString(candidate.merchantID) ??
      readString(candidate.merchantId);

    if (key === undefined) {
      errors.push(
        'key is required: the identifier this failure applies to (sent as x-stub-key, ?key=, or key in the body)',
      );
    } else if (key.length > MAX_KEY_LENGTH) {
      errors.push(`key must be at most ${MAX_KEY_LENGTH} characters`);
    }

    const status = candidate.status ?? 500;

    if (
      typeof status !== 'number' ||
      !Number.isInteger(status) ||
      status < 100 ||
      status > 599
    ) {
      errors.push('status must be an integer between 100 and 599');
    }

    const delayMs = candidate.delayMs ?? 0;

    if (
      typeof delayMs !== 'number' ||
      !Number.isInteger(delayMs) ||
      delayMs < 0 ||
      delayMs > MAX_DELAY_MS
    ) {
      errors.push(`delayMs must be between 0 and ${MAX_DELAY_MS}`);
    }

    const times = candidate.times ?? 1;

    if (typeof times !== 'number' || !Number.isInteger(times) || times < 0) {
      errors.push('times must be a whole number of calls, 0 for unlimited');
    }

    if (candidate.headers !== undefined) {
      const headers = asRecord(candidate.headers);

      if (!headers) {
        errors.push('headers must be an object of strings');
      } else {
        for (const [name, value] of Object.entries(headers)) {
          if (typeof value !== 'string') {
            errors.push(`headers.${name} must be a string`);
          }
        }
      }
    }

    if (errors.length > 0) {
      throw invalid(errors);
    }

    const limit = this.options?.maxRules ?? DEFAULT_MAX_RULES;

    if (this.failures.size >= limit) {
      throw invalid([
        `there are already ${limit} failures installed; delete some first`,
      ]);
    }

    const failure: StubFailure = {
      key: key as string,
      status: status as number,
      delayMs: delayMs as number,
      ...(candidate.headers !== undefined
        ? { headers: candidate.headers as Record<string, string> }
        : {}),
      ...('body' in candidate ? { body: candidate.body } : {}),
      remaining: times as number,
      createdAt: new Date().toISOString(),
    };

    // One failure per key: a second install for the same key is a correction, not a
    // queue. Otherwise a setup step run twice would fail two calls instead of one.
    this.failures.set(failure.key, failure);

    return failure;
  }

  all(): StubFailure[] {
    return [...this.failures.values()];
  }

  /**
   * Read and remove one matching call's worth of failure.
   *
   * Consuming rather than reading keeps the blast radius to one request: a 409 meant
   * for the item-update case must not also fail the batch case that follows it.
   */
  take(key: string): StubFailure | undefined {
    const failure = this.failures.get(key);

    if (!failure) {
      return undefined;
    }

    if (failure.remaining > 0) {
      failure.remaining -= 1;

      if (failure.remaining === 0) {
        this.failures.delete(key);
      }
    }

    return failure;
  }

  /** Clear every failure, or one key's failure, and report how many went. */
  clear(key?: string): number {
    if (key === undefined) {
      const count = this.failures.size;

      this.failures.clear();

      return count;
    }

    return this.failures.delete(key) ? 1 : 0;
  }
}

function invalid(errors: string[]): BadRequestException {
  return new BadRequestException({
    message: errors.join('; '),
    errors,
  });
}
