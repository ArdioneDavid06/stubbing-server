import { BadRequestException } from '@nestjs/common';
import { Failures } from '../src/core/failures/failures.service';
import { defaultKeyOf } from '../src/core/failures/key-source';
import type { ResolvedStubOptions } from '../src/core/stub-options';

function options(): ResolvedStubOptions {
  return {
    presets: [],
    keyOf: defaultKeyOf,
    maxRules: 200,
    maxRecorded: 500,
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

describe('Failures', () => {
  let failures: Failures;

  beforeEach(() => {
    failures = new Failures(options());
  });

  it('installs the shape the plan promises, defaulting to 500 and one call', () => {
    const failure = failures.add({ key: 'C-1', status: 409 });

    expect(failure).toMatchObject({
      key: 'C-1',
      status: 409,
      delayMs: 0,
      remaining: 1,
    });
  });

  it('fails by default, so a failure with no status is not a no-op', () => {
    expect(failures.add({ key: 'C-1' }).status).toBe(500);
  });

  it('accepts merchantID, so a collection written for the old stub still runs', () => {
    const failure = failures.add({ merchantID: 'GF-ALA001', status: 409 });

    expect(failure.key).toBe('GF-ALA001');
    expect(failures.take('GF-ALA001')?.status).toBe(409);
  });

  it('prefers key when a caller sends both', () => {
    expect(failures.add({ key: 'new', merchantID: 'old' }).key).toBe('new');
  });

  it('is consumed by one call, so one rule drives one case', () => {
    failures.add({ key: 'C-1', status: 409 });

    expect(failures.take('C-1')?.status).toBe(409);
    expect(failures.take('C-1')).toBeUndefined();
    expect(failures.all()).toEqual([]);
  });

  it('can be installed for more than one call when a case needs it', () => {
    failures.add({ key: 'C-1', status: 503, times: 2 });

    expect(failures.take('C-1')?.status).toBe(503);
    expect(failures.take('C-1')?.status).toBe(503);
    expect(failures.take('C-1')).toBeUndefined();
  });

  it('treats times 0 as unlimited', () => {
    failures.add({ key: 'C-1', status: 500, times: 0 });

    for (let index = 0; index < 5; index += 1) {
      expect(failures.take('C-1')?.status).toBe(500);
    }
  });

  it('replaces a second install for the same key instead of queueing it', () => {
    failures.add({ key: 'C-1', status: 409 });
    failures.add({ key: 'C-1', status: 429 });

    expect(failures.all()).toHaveLength(1);
    expect(failures.take('C-1')?.status).toBe(429);
  });

  it('keeps the body, the delay and the headers the caller asked for', () => {
    const failure = failures.add({
      key: 'C-1',
      status: 429,
      delayMs: 250,
      headers: { 'retry-after': '10' },
      body: { error: 'TOO_MANY' },
    });

    expect(failure).toMatchObject({
      delayMs: 250,
      headers: { 'retry-after': '10' },
      body: { error: 'TOO_MANY' },
    });
  });

  it('lets a 2xx carry an error body, which is not the same as a failure status', () => {
    const failure = failures.add({
      key: 'C-1',
      status: 200,
      body: { errorReasons: ['x'] },
    });

    expect(failure.status).toBe(200);
    expect(failure.body).toEqual({ errorReasons: ['x'] });
  });

  describe('validation', () => {
    it('requires a key and says where the key can come from', () => {
      const message = messagesOf(
        captureError(() => failures.add({ status: 409 })),
      );

      expect(message).toContain('key is required');
      expect(message).toContain('x-stub-key');
    });

    it('rejects a status or delay outside the allowed range', () => {
      for (const status of [99, 600, 1.5, '409']) {
        expect(() => failures.add({ key: 'k', status })).toThrow(
          BadRequestException,
        );
      }

      for (const delayMs of [-1, 600_001, 1.5]) {
        expect(() => failures.add({ key: 'k', delayMs })).toThrow(
          BadRequestException,
        );
      }
    });

    it('rejects a times value that is not a whole number', () => {
      for (const times of [-1, 1.5, '1']) {
        expect(() => failures.add({ key: 'k', times })).toThrow(
          BadRequestException,
        );
      }
    });

    it('rejects unknown fields, so a typo does not install a 500 nobody asked for', () => {
      expect(() => failures.add({ key: 'k', statuss: 409 })).toThrow(
        BadRequestException,
      );
    });

    it('rejects a key that is not a string', () => {
      expect(() => failures.add({ key: 42 })).toThrow(BadRequestException);
    });
  });

  describe('clear', () => {
    it('clears one key and reports whether it existed', () => {
      failures.add({ key: 'a' });
      failures.add({ key: 'b' });

      expect(failures.clear('a')).toBe(1);
      expect(failures.clear('a')).toBe(0);
      expect(failures.all()).toHaveLength(1);
    });

    it('clears everything and reports how many', () => {
      failures.add({ key: 'a' });
      failures.add({ key: 'b' });

      expect(failures.clear()).toBe(2);
      expect(failures.all()).toEqual([]);
    });
  });
});
