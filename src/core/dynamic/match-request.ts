import type { IncomingRequest, RuleRequestMatch } from './rule.types';

/** A header value wrapped in slashes is a regular expression: `/^Bearer \S+$/`. */
const REGEX_HEADER = /^\/(.*)\/([gimsuy]*)$/;

/**
 * Compile the regular expression a header matcher describes.
 *
 * Returns `undefined` when the value is a literal. Throws when the value looks like a
 * regular expression but does not compile - the rule endpoint turns that into a 400
 * rather than leaving a rule that silently matches nothing.
 */
export function headerMatcher(value: string): RegExp | undefined {
  const match = REGEX_HEADER.exec(value);

  if (!match) {
    return undefined;
  }

  return new RegExp(match[1], match[2]);
}

/** Does a request satisfy every field this rule specifies? */
export function matchesRequest(
  rule: RuleRequestMatch,
  request: IncomingRequest,
): boolean {
  const method = (rule.method ?? '*').toUpperCase();

  if (method !== '*' && method !== request.method.toUpperCase()) {
    return false;
  }

  if (!pathMatches(rule.path, request.path)) {
    return false;
  }

  if (rule.query && !matchesQuery(rule.query, request.query)) {
    return false;
  }

  if (rule.headers && !matchesHeaders(rule.headers, request.headers)) {
    return false;
  }

  return !('body' in rule) || matchesJson(rule.body, request.body);
}

/**
 * Match a path pattern.
 *
 * `:name` stands for one segment and `*` for anything, so a rule can answer a family
 * of calls without one entry per id. Both are deliberate: the calls a stub exists for
 * are usually `/customers/<id>/...`, and hardcoding the ids would make the rule
 * useful exactly once.
 */
export function pathMatches(pattern: string, path: string): boolean {
  let source = '';

  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];

    if (char === '*') {
      source += '.*';
      continue;
    }

    if (char === ':') {
      const name = /^[A-Za-z0-9_]+/.exec(pattern.slice(index + 1));

      if (name) {
        source += '[^/]+';
        index += name[0].length;
        continue;
      }
    }

    source += escapeRegExp(char);
  }

  return new RegExp(`^${source}$`).test(path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesQuery(
  expected: Record<string, string>,
  actual: Record<string, unknown>,
): boolean {
  return Object.entries(expected).every(([key, value]) => {
    const received = actual[key];

    if (received === undefined) {
      return false;
    }

    // A repeated parameter arrives as an array; any of its values matching is what
    // the caller meant by `?tag=a&tag=b`.
    if (Array.isArray(received)) {
      return received.map(asQueryString).includes(value);
    }

    return asQueryString(received) === value;
  });
}

/** Render a query value as text without relying on Object.prototype.toString. */
function asQueryString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value) ?? '';
}

function matchesHeaders(
  expected: Record<string, string>,
  actual: Record<string, string>,
): boolean {
  return Object.entries(expected).every(([name, value]) => {
    const received = actual[name.toLowerCase()];

    if (received === undefined) {
      return false;
    }

    const regex = headerMatcher(value);

    return regex ? regex.test(received) : received === value;
  });
}

/**
 * Match a JSON body as a subset.
 *
 * Objects may omit fields: a rule that cares about one id should not have to repeat
 * the rest of the payload. Arrays are compared by length and element, because a
 * subset of an array is ambiguous and guessing would make a rule match wider than it
 * reads.
 */
export function matchesJson(expected: unknown, actual: unknown): boolean {
  if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((item, index) => matchesJson(item, actual[index]))
    );
  }

  if (expected !== null && typeof expected === 'object') {
    if (
      actual === null ||
      typeof actual !== 'object' ||
      Array.isArray(actual)
    ) {
      return false;
    }

    return Object.entries(expected).every(
      ([key, value]) =>
        Object.prototype.hasOwnProperty.call(actual, key) &&
        matchesJson(value, (actual as Record<string, unknown>)[key]),
    );
  }

  return expected === actual;
}
