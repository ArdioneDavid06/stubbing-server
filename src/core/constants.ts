/**
 * Names the package owns. They are part of the contract: a caller sends the session
 * header, and reads the rule header, without importing anything.
 */

/** Sent by the application (or a proxy) to scope a request to one run. */
export const SESSION_HEADER = 'x-stub-session';

/** Set by the stub on every answer that came from a rule, to the rule's id. */
export const RULE_HEADER = 'x-stub-rule';

/** A generic reader for a failure key, when the caller would rather use a header. */
export const KEY_HEADER = 'x-stub-key';

/**
 * `/stub/*` is the stub's own management surface; `/health` is its liveness.
 *
 * Neither is ever answered by a rule. A rule of `*` would otherwise swallow the
 * endpoint that removes it, and the way out of a bad rule would be a restart.
 */
export function isManagementPath(url: string): boolean {
  return url.startsWith('/stub/') || url.startsWith('/health');
}
