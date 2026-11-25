import { Rules } from '../src/core/dynamic/rules.service';
import type { IncomingRequest } from '../src/core/dynamic/rule.types';

/**
 * The compatibility test the plan asks for.
 *
 * Every rule a team has stored is a document that outlives the version that read it.
 * This file holds one recorded shape per minor version, and the package's own suite
 * runs all of them: an upgrade that stops honouring an old rule fails here rather
 * than in a consuming team's pipeline.
 *
 * When the rule format grows, add the new shape as a new entry and leave the old ones
 * alone. Never edit an entry that a released version accepted.
 */

interface RecordedShape {
  /** The version that first accepted this shape. */
  since: string;
  /** What a team wrote, byte for byte where whitespace does not matter. */
  document: Record<string, unknown>;
  /** The call it must answer. */
  call: IncomingRequest;
  /** What must come back. */
  expected: { status: number; body?: unknown };
}

const V1_SHAPES: RecordedShape[] = [
  {
    since: '1.0.0',
    document: {
      method: 'PUT',
      path: '/partner/v1/orders/42',
      status: 409,
      body: { message: 'too soon', retryAfterSeconds: 10 },
      sessionId: 'checkout-run-7',
      times: 1,
    },
    call: {
      method: 'PUT',
      path: '/partner/v1/orders/42',
      query: {},
      headers: {},
      body: { total: 10 },
      session: 'checkout-run-7',
    },
    expected: {
      status: 409,
      body: { message: 'too soon', retryAfterSeconds: 10 },
    },
  },
  {
    since: '1.0.0',
    document: {
      method: 'GET',
      path: '/v2/customers/:id',
      status: 200,
      body: { id: 'C-1', name: 'Ada', tier: 'GOLD' },
      sessionId: 'onboarding',
    },
    call: {
      method: 'GET',
      path: '/v2/customers/C-1',
      query: {},
      headers: {},
      body: null,
      session: 'onboarding',
    },
    expected: { status: 200, body: { id: 'C-1', name: 'Ada', tier: 'GOLD' } },
  },
  {
    since: '1.0.0',
    document: {
      method: 'GET',
      path: '/v2/customers/missing',
      status: 404,
      body: { error: 'CUSTOMER_NOT_FOUND' },
      times: 1,
    },
    call: {
      method: 'GET',
      path: '/v2/customers/missing',
      query: {},
      headers: {},
      body: null,
    },
    expected: { status: 404, body: { error: 'CUSTOMER_NOT_FOUND' } },
  },
  {
    since: '1.0.0',
    document: {
      name: 'the long shape, for a rule that must be narrower',
      request: {
        method: 'POST',
        path: '/v2/widgets',
        query: { region: 'ph' },
        headers: { authorization: '/^Bearer /' },
        body: { kind: 'blue' },
      },
      response: { status: 202, body: { accepted: true } },
    },
    call: {
      method: 'POST',
      path: '/v2/widgets',
      query: { region: 'ph' },
      headers: { authorization: 'Bearer abc' },
      body: { kind: 'blue', extra: true },
    },
    expected: { status: 202, body: { accepted: true } },
  },
];

describe('every rule shape a released version accepted still works', () => {
  it.each(
    V1_SHAPES.map((shape) => [
      shape.since,
      shape.document.path ?? 'long',
      shape,
    ]),
  )('v%s answers the call recorded for %s', (_since, _label, shape) => {
    const rules = new Rules();
    const installed = rules.add(shape.document);

    const matched = rules.match(shape.call);

    expect(matched?.id).toBe(installed.id);
    expect(matched?.response.status).toBe(shape.expected.status);

    if (shape.expected.body !== undefined) {
      expect(matched?.response.body).toEqual(shape.expected.body);
    }
  });

  it('records the versions this suite currently covers', () => {
    const covered = [...new Set(V1_SHAPES.map((shape) => shape.since))];

    expect(covered).toEqual(['1.0.0']);
  });
});
