import { BadRequestException } from '@nestjs/common';
import { Rules } from '../src/core/dynamic/rules.service';
import type { IncomingRequest } from '../src/core/dynamic/rule.types';
import type { KeyRequest } from '../src/core/failures/key-source';
import { SESSION_HEADER } from '../src/core/constants';
import { defaultKeyOf } from '../src/core/failures/key-source';
import { merchantIdAliasKeyOf } from '../src/compat/merchant-id';

function incoming(overrides: Partial<IncomingRequest> = {}): IncomingRequest {
  return {
    method: 'GET',
    path: '/v2/customers/C-1',
    query: {},
    headers: {},
    body: null,
    ...overrides,
  };
}

function messagesOf(error: unknown): string {
  return JSON.stringify((error as BadRequestException).getResponse());
}

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }

  throw new Error('expected the action to throw');
}

describe('Rules', () => {
  let rules: Rules;

  beforeEach(() => {
    rules = new Rules();
  });

  describe('the two shapes mean the same thing', () => {
    it('accepts the flat shape from the plan', () => {
      const rule = rules.add({
        method: 'PUT',
        path: '/partner/v1/orders/42',
        status: 409,
        body: { message: 'too soon', retryAfterSeconds: 10 },
        sessionId: 'checkout-run-7',
        times: 1,
      });

      expect(rule.form).toBe('flat');
      expect(rule.request).toEqual({
        method: 'PUT',
        path: '/partner/v1/orders/42',
      });
      expect(rule.response).toEqual({
        status: 409,
        delayMs: 0,
        body: { message: 'too soon', retryAfterSeconds: 10 },
      });
      expect(rule.sessionId).toBe('checkout-run-7');
      expect(rule.remaining).toBe(1);
    });

    it('normalises the long shape to the same stored rule', () => {
      const flat = rules.add({
        method: 'GET',
        path: '/v2/customers/:id',
        status: 200,
        body: { id: 'C-1' },
      });
      const long = rules.add({
        request: { method: 'GET', path: '/v2/customers/:id' },
        response: { status: 200, body: { id: 'C-1' } },
      });

      expect(long.request).toEqual(flat.request);
      expect(long.response).toEqual(flat.response);
      expect(long.form).toBe('long');
      expect(flat.form).toBe('flat');
    });

    it('defaults method to * and status to 200', () => {
      const rule = rules.add({ path: '/anything' });

      expect(rule.request.method).toBeUndefined();
      expect(rule.response).toEqual({ status: 200, delayMs: 0 });
      expect(rule.remaining).toBe(0);
    });

    it('refuses a rule that mixes the two shapes, and says which fields did it', () => {
      const message = messagesOf(
        captureError(() =>
          rules.add({
            path: '/a',
            status: 500,
            request: { path: '/a' },
          }),
        ),
      );

      expect(message).toContain('not both');
      expect(message).toContain('path');
      expect(message).toContain('status');
    });

    it('requires one shape or the other', () => {
      const message = messagesOf(
        captureError(() => rules.add({ name: 'nothing' })),
      );

      expect(message).toContain(
        '`path` (flat form) or `request.path` (long form)',
      );
    });
  });

  describe('validation', () => {
    it('rejects a body that is not an object', () => {
      for (const input of [null, [], 'GET /a', 42]) {
        expect(() => rules.add(input)).toThrow(BadRequestException);
      }

      expect(messagesOf(captureError(() => rules.add(null)))).toContain(
        'the body must be an object',
      );
    });

    it('requires an absolute path', () => {
      expect(() => rules.add({ path: 'a' })).toThrow(BadRequestException);
      expect(() => rules.add({ request: { path: 'a' } })).toThrow(
        BadRequestException,
      );
      expect(() => rules.add({ path: '*' })).not.toThrow();
    });

    it('rejects an unknown method', () => {
      const message = messagesOf(
        captureError(() => rules.add({ path: '/a', method: 'TRACE' })),
      );

      expect(message).toContain('method must be one of');
    });

    it('rejects matchers of the wrong shape', () => {
      expect(() => rules.add({ request: { path: '/a', query: [] } })).toThrow(
        BadRequestException,
      );
      expect(() =>
        rules.add({ request: { path: '/a', query: { page: 2 } } }),
      ).toThrow(BadRequestException);
      expect(() =>
        rules.add({ request: { path: '/a', headers: 'Bearer' } }),
      ).toThrow(BadRequestException);
    });

    it('rejects a header matcher that does not compile', () => {
      const message = messagesOf(
        captureError(() =>
          rules.add({
            request: { path: '/a', headers: { authorization: '/[/' } },
          }),
        ),
      );

      expect(message).toContain('not a valid regular expression');
    });

    it('rejects a status or delay outside the allowed range', () => {
      for (const status of [99, 600, 200.5, '200']) {
        expect(() => rules.add({ path: '/a', status })).toThrow(
          BadRequestException,
        );
      }

      for (const delayMs of [-1, 600_001, 1.5, '10']) {
        expect(() => rules.add({ path: '/a', delayMs })).toThrow(
          BadRequestException,
        );
      }
    });

    it('rejects a times value that is not a whole number of calls', () => {
      for (const times of [-1, 1.5, '1']) {
        expect(() => rules.add({ path: '/a', times })).toThrow(
          BadRequestException,
        );
      }
    });

    it('rejects an empty sessionId, because it would scope a rule to nobody', () => {
      expect(() => rules.add({ path: '/a', sessionId: '' })).toThrow(
        BadRequestException,
      );
      expect(() => rules.add({ path: '/a', sessionId: '   ' })).toThrow(
        BadRequestException,
      );
    });

    it('rejects unknown fields, so a typo does not silently become a 200 stub', () => {
      expect(() => rules.add({ path: '/a', resonse: { status: 500 } })).toThrow(
        BadRequestException,
      );
      expect(() => rules.add({ path: '/a', url: '/b' })).toThrow(
        BadRequestException,
      );
      expect(() =>
        rules.add({ request: { path: '/a' }, response: { code: 500 } }),
      ).toThrow(BadRequestException);
    });

    it('reports every problem at once rather than the first', () => {
      const message = messagesOf(
        captureError(() =>
          rules.add({
            request: { path: 'a', method: 'TRACE' },
            response: { status: 99 },
          }),
        ),
      );

      expect(message).toContain('request.path');
      expect(message).toContain('request.method');
      expect(message).toContain('response.status');
    });

    it('stops at the rule limit instead of growing without bound', () => {
      const bounded = new Rules({
        presets: [],
        keyOf: defaultKeyOf,
        maxRules: 3,
        maxRecorded: 10,
      });

      bounded.add({ path: '/1' });
      bounded.add({ path: '/2' });
      bounded.add({ path: '/3' });

      expect(() => bounded.add({ path: '/4' })).toThrow(BadRequestException);
      expect(bounded.list()).toHaveLength(3);
    });
  });

  describe('match', () => {
    it('returns undefined when nothing matches, and does not spend a limited rule', () => {
      rules.add({ path: '/a', body: { ok: true }, times: 1 });

      expect(rules.match(incoming({ path: '/b' }))).toBeUndefined();
      expect(rules.match(incoming({ path: '/a' }))?.response.body).toEqual({
        ok: true,
      });
    });

    it('lets the first installed rule win', () => {
      rules.add({ path: '/a/*', body: { rule: 'broad' } });
      rules.add({ path: '/a/b', body: { rule: 'narrow' } });

      expect(rules.match(incoming({ path: '/a/b' }))?.response.body).toEqual({
        rule: 'broad',
      });
    });

    it('counts a limited rule down and removes it after its last call', () => {
      const rule = rules.add({ path: '/a', status: 529, times: 2 });

      expect(rules.match(incoming({ path: '/a' }))?.id).toBe(rule.id);
      expect(rules.list()[0].remaining).toBe(1);

      expect(rules.match(incoming({ path: '/a' }))?.id).toBe(rule.id);
      expect(rules.list()).toEqual([]);
      expect(rules.match(incoming({ path: '/a' }))).toBeUndefined();
    });

    it('keeps an unlimited rule installed after it matches', () => {
      rules.add({ path: '/a' });

      rules.match(incoming({ path: '/a' }));
      rules.match(incoming({ path: '/a' }));

      expect(rules.list()).toHaveLength(1);
    });

    it('answers a path the stub has no route for', () => {
      rules.add({ method: 'POST', path: '/third-party/*', status: 201 });

      const rule = rules.match(
        incoming({ method: 'POST', path: '/third-party/orders/42' }),
      );

      expect(rule?.response.status).toBe(201);
    });
  });

  describe('sessions', () => {
    it('hides a scoped rule from a request without that session', () => {
      rules.add({ path: '/a', sessionId: 'run-1', body: { from: 'run-1' } });

      expect(rules.match(incoming({ path: '/a' }))).toBeUndefined();
      expect(
        rules.match(incoming({ path: '/a', session: 'run-2' })),
      ).toBeUndefined();
      expect(
        rules.match(incoming({ path: '/a', session: 'run-1' }))?.response.body,
      ).toEqual({ from: 'run-1' });
    });

    it('lets two runs install the same path without answering each other', () => {
      rules.add({ path: '/a', sessionId: 'run-1', body: { from: 'run-1' } });
      rules.add({ path: '/a', sessionId: 'run-2', body: { from: 'run-2' } });

      expect(
        rules.match(incoming({ path: '/a', session: 'run-2' }))?.response.body,
      ).toEqual({ from: 'run-2' });
    });

    it('lists and clears one session without touching the others', () => {
      rules.add({ path: '/a', sessionId: 'run-1' });
      rules.add({ path: '/b', sessionId: 'run-1' });
      rules.add({ path: '/c', sessionId: 'run-2' });

      expect(rules.list('run-1')).toHaveLength(2);
      expect(rules.clear('run-1')).toBe(2);
      expect(rules.list()).toHaveLength(1);
    });
  });

  describe('remove and clear', () => {
    it('removes one rule and reports whether it existed', () => {
      const rule = rules.add({ path: '/a' });

      expect(rules.remove(rule.id)).toBe(true);
      expect(rules.list()).toEqual([]);
      expect(rules.remove(rule.id)).toBe(false);
    });

    it('clears every rule and reports how many', () => {
      rules.add({ path: '/a' });
      rules.add({ path: '/b' });

      expect(rules.clear()).toBe(2);
      expect(rules.list()).toEqual([]);
      expect(rules.clear()).toBe(0);
    });
  });
});

describe('the session header is the contract, not a detail', () => {
  it('is a header name a caller can hard-code', () => {
    expect(SESSION_HEADER).toBe('x-stub-session');
  });
});

describe('where a failure key is read from', () => {
  function request(overrides: Partial<KeyRequest> = {}): KeyRequest {
    return {
      method: 'POST',
      path: '/v2/orders',
      query: {},
      headers: {},
      body: null,
      ...overrides,
    };
  }

  it('reads a header, then the query, then the body', () => {
    expect(defaultKeyOf(request({ headers: { 'x-stub-key': 'h' } }))).toBe('h');
    expect(defaultKeyOf(request({ query: { key: 'q' } }))).toBe('q');
    expect(defaultKeyOf(request({ body: { key: 'b' } }))).toBe('b');
    expect(defaultKeyOf(request())).toBeUndefined();
  });

  it('ignores an empty value rather than failing on an empty key', () => {
    expect(
      defaultKeyOf(request({ headers: { 'x-stub-key': '' } })),
    ).toBeUndefined();
  });

  it('knows nothing about a partner, so the legacy name has to be added', () => {
    const body = { body: { merchantID: 'GF-ALA001' } };

    expect(defaultKeyOf(request(body))).toBeUndefined();
    expect(merchantIdAliasKeyOf(request(body))).toBe('GF-ALA001');
  });

  it('accepts the legacy name in the query too, which is where the old stub read it', () => {
    expect(
      merchantIdAliasKeyOf(request({ query: { merchantID: 'GF-ALA001' } })),
    ).toBe('GF-ALA001');
  });
});
