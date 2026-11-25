import {
  headerMatcher,
  matchesJson,
  matchesRequest,
  pathMatches,
} from '../src/core/dynamic/match-request';
import type { IncomingRequest } from '../src/core/dynamic/rule.types';

function incoming(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    method: 'GET',
    path: '/a',
    query: {},
    headers: {},
    body: null,
    ...overrides,
  };
}

describe('pathMatches', () => {
  it('matches an exact path', () => {
    expect(pathMatches('/v2/customers', '/v2/customers')).toBe(true);
    expect(pathMatches('/v2/customers', '/v2/customers/1')).toBe(false);
  });

  it('treats :name as exactly one segment', () => {
    expect(pathMatches('/v2/customers/:id', '/v2/customers/C-1')).toBe(true);
    expect(pathMatches('/v2/customers/:id', '/v2/customers')).toBe(false);
    expect(pathMatches('/v2/customers/:id', '/v2/customers/C-1/orders')).toBe(
      false,
    );
    expect(
      pathMatches('/v2/customers/:id/orders', '/v2/customers/C-1/orders'),
    ).toBe(true);
  });

  it('treats * as anything, slashes included', () => {
    expect(pathMatches('/v2/*', '/v2/customers/C-1/orders')).toBe(true);
    expect(pathMatches('*', '/anything/at/all')).toBe(true);
    expect(pathMatches('/v2/*', '/v3/customers')).toBe(false);
  });

  it('does not let a path be a regular expression by accident', () => {
    expect(pathMatches('/v2/a.b', '/v2/axb')).toBe(false);
    expect(pathMatches('/v2/(x)', '/v2/(x)')).toBe(true);
  });
});

describe('headerMatcher', () => {
  it('returns undefined for a literal', () => {
    expect(headerMatcher('Bearer abc')).toBeUndefined();
  });

  it('compiles a slashed value as a regular expression', () => {
    expect(headerMatcher('/^Bearer \\S+$/')?.test('Bearer abc')).toBe(true);
    expect(headerMatcher('/^Bearer \\S+$/')?.test('Basic abc')).toBe(false);
  });

  it('throws on a value that looks like a regular expression but is not', () => {
    expect(() => headerMatcher('/[/')).toThrow();
  });
});

describe('matchesRequest', () => {
  it('defaults the method to any', () => {
    expect(
      matchesRequest(
        { path: '/a' },
        incoming({ method: 'DELETE', path: '/a' }),
      ),
    ).toBe(true);
  });

  it('compares the method case-insensitively', () => {
    expect(
      matchesRequest(
        { method: 'post', path: '/a' },
        incoming({ method: 'POST', path: '/a' }),
      ),
    ).toBe(true);
    expect(
      matchesRequest(
        { method: 'POST', path: '/a' },
        incoming({ method: 'GET', path: '/a' }),
      ),
    ).toBe(false);
  });

  it('requires every query parameter it names, and ignores the rest', () => {
    const request = incoming({ query: { page: '2', limit: '10' } });

    expect(matchesRequest({ path: '/a', query: { page: '2' } }, request)).toBe(
      true,
    );
    expect(matchesRequest({ path: '/a', query: { page: '3' } }, request)).toBe(
      false,
    );
    expect(
      matchesRequest({ path: '/a', query: { sort: 'asc' } }, request),
    ).toBe(false);
  });

  it('matches a repeated query parameter when any value matches', () => {
    const request = incoming({ query: { tag: ['a', 'b'] } });

    expect(matchesRequest({ path: '/a', query: { tag: 'b' } }, request)).toBe(
      true,
    );
    expect(matchesRequest({ path: '/a', query: { tag: 'c' } }, request)).toBe(
      false,
    );
  });

  it('matches headers by lower-case name, literally or by regular expression', () => {
    const request = incoming({ headers: { authorization: 'Bearer abc' } });

    expect(
      matchesRequest(
        { path: '/a', headers: { authorization: '/^Bearer /' } },
        request,
      ),
    ).toBe(true);
    expect(
      matchesRequest(
        { path: '/a', headers: { authorization: 'Bearer abc' } },
        request,
      ),
    ).toBe(true);
    expect(
      matchesRequest(
        { path: '/a', headers: { authorization: 'Basic abc' } },
        request,
      ),
    ).toBe(false);
  });

  it('matches a body as a subset, so a rule does not repeat the payload', () => {
    const request = incoming({
      body: { customer: { id: 'C-1', tier: 'GOLD' }, note: 'x' },
    });

    expect(
      matchesRequest(
        { path: '/a', body: { customer: { id: 'C-1' } } },
        request,
      ),
    ).toBe(true);
    expect(
      matchesRequest(
        { path: '/a', body: { customer: { id: 'C-2' } } },
        request,
      ),
    ).toBe(false);
  });

  it('does not match a body rule against a request with no body', () => {
    expect(
      matchesRequest({ path: '/a', body: { id: 'C-1' } }, incoming()),
    ).toBe(false);
  });

  it('makes a rule with no body matcher match any body', () => {
    expect(
      matchesRequest({ path: '/a' }, incoming({ body: { anything: true } })),
    ).toBe(true);
  });
});

describe('matchesJson', () => {
  it('compares arrays by length and element, because a subset is ambiguous', () => {
    expect(matchesJson(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(matchesJson(['a'], ['a', 'b'])).toBe(false);
    expect(matchesJson([{ id: 1 }], [{ id: 1 }])).toBe(true);
  });

  it('distinguishes null from a missing key', () => {
    expect(matchesJson({ a: null }, { a: null })).toBe(true);
    expect(matchesJson({ a: null }, {})).toBe(false);
  });

  it('treats an array as incompatible with an object', () => {
    expect(matchesJson({ a: {} }, { a: [] })).toBe(false);
    expect(matchesJson({ a: [] }, { a: {} })).toBe(false);
  });
});
