import { KEY_HEADER } from '../constants';

/** The parts of a request a failure key is read from. */
export interface KeyRequest {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * Where a partner's failure key lives.
 *
 * A preset supplies one when it knows its partner's shape. The generic readers below
 * are the fallback for a team that has not written a preset yet.
 */
export type KeyExtractor = (request: KeyRequest) => string | undefined;

/**
 * The partner-agnostic readers, in order: a header the caller sets explicitly, then
 * `key` in the query string, then `key` in the JSON body.
 *
 * Nothing here names a partner. A team whose partner puts the identifier somewhere
 * else writes one line in its preset instead of teaching core a new field name.
 */
export const defaultKeyOf: KeyExtractor = (request) =>
  readString(request.headers[KEY_HEADER]) ??
  readString(request.query.key) ??
  readString(asRecord(request.body)?.key);

/** Ask each extractor in turn and take the first answer. */
export function composeKeyExtractors(
  extractors: readonly KeyExtractor[],
): KeyExtractor {
  return (request) => {
    for (const extractor of extractors) {
      const key = extractor(request);

      if (key !== undefined) {
        return key;
      }
    }

    return undefined;
  };
}

export function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
