import { Inject, Injectable, Optional } from '@nestjs/common';
import { STUB_OPTIONS } from '../stub-options';
import type { ResolvedStubOptions } from '../stub-options';

export interface RecordedRequest {
  /** Monotonic counter, so a test can assert on order rather than on timestamps. */
  sequence: number;
  method: string;
  path: string;
  /** The path the caller used, query string included. */
  originalPath: string;
  /** Query parameters, as the caller sent them. */
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
  /** When it arrived, ISO 8601. Useful when reading the log by eye. */
  receivedAt: string;
  /**
   * The status the stub answered with, filled in when the response finishes.
   *
   * A 404 is the most useful thing this records: it means the application called a
   * path nobody stubbed, which in production is a silent failure with a
   * plausible-looking timeout.
   */
  responseStatus?: number;
  /** The installed rule that answered, when one did. Filled in when the response finishes. */
  ruleId?: string;
}

/** Injection token, so the controller and tests depend on the class by contract. */
export const STUB_RECORDER = 'STUB_RECORDER';

/**
 * Records every request the stub receives.
 *
 * This is the part that makes the stub useful rather than merely convenient. A test
 * can assert not just that the application succeeded, but that it called the partner
 * with the body the partner expects - the failure a response assertion misses
 * entirely.
 */
@Injectable()
export class Recorder {
  private readonly requests: RecordedRequest[] = [];
  private sequence = 0;

  constructor(
    @Optional()
    @Inject(STUB_OPTIONS)
    private readonly options?: ResolvedStubOptions,
  ) {}

  /**
   * Record a request as it arrives, and return the stored entry.
   *
   * The caller keeps the reference and fills in `responseStatus` and `ruleId` when the
   * answer is known. Recording at arrival rather than at the end keeps `sequence` in
   * the order the calls were made, which is the order a test asserts on even when one
   * of them was delayed on purpose.
   */
  record(
    entry: Omit<RecordedRequest, 'sequence' | 'receivedAt'>,
  ): RecordedRequest {
    this.sequence += 1;

    const stored: RecordedRequest = {
      ...entry,
      sequence: this.sequence,
      receivedAt: new Date().toISOString(),
    };

    this.requests.push(stored);

    const limit = this.options?.maxRecorded ?? 500;

    if (this.requests.length > limit) {
      this.requests.splice(0, this.requests.length - limit);
    }

    return stored;
  }

  all(): RecordedRequest[] {
    return [...this.requests];
  }

  /** Every recorded call whose path contains the given fragment. */
  matching(fragment: string): RecordedRequest[] {
    return this.requests.filter((request) => request.path.includes(fragment));
  }

  clear(): void {
    this.requests.length = 0;
    this.sequence = 0;
  }
}
