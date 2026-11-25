/**
 * Request headers with lower-case names and repeated values joined, which is how a
 * rule and a failure key both want to read them.
 *
 * A header name is case-insensitive in HTTP, so a matcher written `Authorization`
 * has to find `authorization`, and `x-stub-key` has to be found however the caller
 * spelled it.
 */
export function normaliseHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name.toLowerCase(),
      Array.isArray(value) ? value.join(',') : String(value ?? ''),
    ]),
  );
}
