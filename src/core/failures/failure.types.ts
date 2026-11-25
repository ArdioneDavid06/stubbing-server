/**
 * Failure injection: make one call fail, on demand.
 *
 * A partner will not answer 409 because a test asked nicely, so the failure a ticket
 * names is untestable against them and testable against this. The switch is keyed on
 * one identifier the caller already sends, and it is consumed by one matching call,
 * so one rule drives one case instead of poisoning the rest of the run.
 */

/** What a caller posts to `POST /stub/failures`. */
export interface StubFailureInput {
  /**
   * The identifier to fail on. How it is read depends on where the caller sends it:
   * `x-stub-key`, `?key=`, or `key` in the JSON body, unless a preset says otherwise.
   */
  key?: string;
  /** Legacy spelling of `key`, accepted for Remote's existing collection. */
  merchantID?: string;
  /** HTTP status to answer with. Defaults to 500, because a failure should fail. */
  status?: number;
  /** Body to send, so a reason can be asserted. */
  body?: unknown;
  /** Milliseconds to stall before answering. Pair with a 200 to provoke a timeout. */
  delayMs?: number;
  /** Response headers, so a `Retry-After` can be asserted. */
  headers?: Record<string, string>;
  /**
   * How many matching calls it fails before removing itself. Defaults to 1: one rule,
   * one case.
   */
  times?: number;
}

/** A failure as the stub stores and returns it. */
export interface StubFailure {
  key: string;
  status: number;
  body?: unknown;
  delayMs: number;
  headers?: Record<string, string>;
  /** Calls left before the failure removes itself. `0` means unlimited. */
  remaining: number;
  createdAt: string;
}

/** What the middleware and the controller need from the registry. */
export interface FailureStore {
  add(input: unknown): StubFailure;
  all(): StubFailure[];
  take(key: string): StubFailure | undefined;
  clear(key?: string): number;
}
