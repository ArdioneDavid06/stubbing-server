import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { startStubServer } from '../src/app/container';
import type { RunningStub } from '../src/app/container';
import { RULE_HEADER, SESSION_HEADER } from '../src/core/constants';
import { Recorder } from '../src/core/recorder/recorder.service';
import { Rules } from '../src/core/dynamic/rules.service';
import { Failures } from '../src/core/failures/failures.service';

/**
 * The whole product over a real socket: install a rule, call it, read back what the
 * application sent. These are the tests that fail if the middleware order is wrong.
 */
describe('the stub over HTTP', () => {
  let stub: RunningStub;
  let app: INestApplication;
  let http: request.Agent;

  beforeAll(async () => {
    stub = await startStubServer({ port: 0 });
    app = stub.app;
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await stub.close();
  });

  beforeEach(() => {
    app.get(Rules).clear();
    app.get(Failures).clear();
    app.get(Recorder).clear();
  });

  /** `res.on('finish')` runs just after the client sees the last byte; wait for it. */
  async function until<T>(
    read: () => T | undefined,
    label: string,
  ): Promise<T> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const value = read();

      if (value !== undefined) {
        return value;
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    throw new Error(`timed out waiting for ${label}`);
  }

  it('reports liveness without touching any rule', async () => {
    const response = await http.get('/health').expect(200);

    expect(response.body).toEqual({ status: 'ok', now: expect.any(String) });
  });

  describe('a rule answers a call', () => {
    it('answers a path the stub has no route for, and names the rule', async () => {
      const installed = await http
        .post('/stub/rules')
        .send({
          method: 'GET',
          path: '/v2/customers/:id',
          status: 200,
          body: { id: 'C-1', name: 'Ada', tier: 'GOLD' },
        })
        .expect(201);

      const response = await http.get('/v2/customers/C-1').expect(200);

      expect(response.body).toEqual({ id: 'C-1', name: 'Ada', tier: 'GOLD' });
      expect(response.headers[RULE_HEADER]).toBe(installed.body.id);
    });

    it('records the call it answered, with the rule id and the status', async () => {
      const installed = await http
        .post('/stub/rules')
        .send({ path: '/v2/orders', status: 201, body: { created: true } })
        .expect(201);

      await http.post('/v2/orders').send({ total: 10 }).expect(201);

      const recorded = await until(
        () =>
          app
            .get(Recorder)
            .all()
            .find((entry) => entry.path === '/v2/orders'),
        'the recorded call',
      );

      expect(recorded).toMatchObject({
        method: 'POST',
        body: { total: 10 },
        responseStatus: 201,
        ruleId: installed.body.id,
      });
    });

    it('records a 404, which is the most useful thing it can report', async () => {
      await http.get('/v2/nobody/stubbed/this').expect(404);

      const recorded = await until(
        () => app.get(Recorder).all()[0],
        'the recorded 404',
      );

      expect(recorded).toMatchObject({
        path: '/v2/nobody/stubbed/this',
        responseStatus: 404,
      });
      expect(recorded.ruleId).toBeUndefined();
    });

    it('filters the recorder by a path fragment', async () => {
      await http.get('/v2/customers/C-1').expect(404);
      await http.get('/v2/orders/O-1').expect(404);

      await until(
        () => (app.get(Recorder).all().length === 2 ? true : undefined),
        'two recorded calls',
      );

      const response = await http
        .get('/stub/requests?path=customers')
        .expect(200);

      expect(response.body).toHaveLength(1);
      expect(response.body[0].path).toBe('/v2/customers/C-1');
    });

    it('sends a string body as text unless a rule says otherwise', async () => {
      await http
        .post('/stub/rules')
        .send({ path: '/v2/plain', body: 'not json' })
        .expect(201);
      await http
        .post('/stub/rules')
        .send({
          path: '/v2/xml',
          headers: { 'content-type': 'application/xml' },
          body: '<ok/>',
        })
        .expect(201);

      const text = await http.get('/v2/plain').expect(200);
      const xml = await http.get('/v2/xml').expect(200);

      expect(text.headers['content-type']).toContain('text/plain');
      expect(text.text).toBe('not json');
      expect(xml.headers['content-type']).toContain('application/xml');
      expect(xml.text).toBe('<ok/>');
    });

    it('stalls before answering when the rule asks it to', async () => {
      await http
        .post('/stub/rules')
        .send({ path: '/v2/slow', delayMs: 120, body: { slow: true } })
        .expect(201);

      const started = Date.now();

      await http.get('/v2/slow').expect(200);

      expect(Date.now() - started).toBeGreaterThanOrEqual(100);
    });

    it('answers with the long shape, narrowing on a header and a body field', async () => {
      await http
        .post('/stub/rules')
        .send({
          name: 'narrow',
          request: {
            method: 'POST',
            path: '/v2/widgets',
            headers: { authorization: '/^Bearer /' },
            body: { kind: 'blue' },
          },
          response: { status: 202, body: { accepted: true } },
        })
        .expect(201);

      await http.post('/v2/widgets').send({ kind: 'blue' }).expect(404);
      await http
        .post('/v2/widgets')
        .set('authorization', 'Bearer token')
        .send({ kind: 'blue', extra: 'x' })
        .expect(202, { accepted: true });
    });

    it('consumes a rule installed with times, so one case does not poison the next', async () => {
      await http
        .post('/stub/rules')
        .send({ path: '/v2/once', body: { once: true }, times: 1 })
        .expect(201);

      await http.get('/v2/once').expect(200);
      await http.get('/v2/once').expect(404);

      const rules = await http.get('/stub/rules').expect(200);

      expect(rules.body).toEqual([]);
    });
  });

  describe('management endpoints are not stubbable', () => {
    it('does not let a rule of * swallow the endpoint that removes it', async () => {
      await http
        .post('/stub/rules')
        .send({ path: '*', status: 599 })
        .expect(201);

      await http.get('/stub/rules').expect(200);
      await http.get('/health').expect(200);

      const cleared = await http.delete('/stub/rules').expect(200);

      expect(cleared.body).toEqual({ cleared: 1 });
    });

    it('does not record its own management calls', async () => {
      await http.get('/stub/requests').expect(200);

      expect(app.get(Recorder).all()).toEqual([]);
    });
  });

  describe('failure injection', () => {
    it('fails one call on demand, keyed on a body field', async () => {
      await http
        .post('/stub/failures')
        .send({ key: 'C-1', status: 409, body: { error: 'TOO_SOON' } })
        .expect(200);

      await http
        .post('/v2/customers/C-1/orders')
        .send({ key: 'C-1' })
        .expect(409, { error: 'TOO_SOON' });

      // consumed: the next call is a plain 404 rather than another failure
      await http
        .post('/v2/customers/C-1/orders')
        .send({ key: 'C-1' })
        .expect(404);
    });

    it('finds the key in the query string too', async () => {
      await http
        .post('/stub/failures')
        .send({ key: 'C-9', status: 503 })
        .expect(200);

      await http.get('/v2/customers/C-9?key=C-9').expect(503);
    });

    it('accepts merchantID, so an old collection does not have to change', async () => {
      await http
        .post('/stub/failures')
        .send({ merchantID: 'M-1', status: 429 })
        .expect(200);

      await http.post('/v2/orders').send({ merchantID: 'M-1' }).expect(429);
    });

    it('leaves the key alone when no failure is installed for it', async () => {
      await http.post('/v2/orders').send({ key: 'nobody' }).expect(404);
    });

    it('beats a path rule, then lets the rule answer once the failure is spent', async () => {
      await http
        .post('/stub/rules')
        .send({ path: '/v2/orders/*', body: { ok: true } })
        .expect(201);
      await http
        .post('/stub/failures')
        .send({ key: 'C-1', status: 409 })
        .expect(200);

      await http.post('/v2/orders/42').send({ key: 'C-1' }).expect(409);
      await http
        .post('/v2/orders/42')
        .send({ key: 'C-1' })
        .expect(200, { ok: true });
    });

    it('list and clear failures', async () => {
      await http
        .post('/stub/failures')
        .send({ key: 'a', status: 500 })
        .expect(200);
      const listed = await http.get('/stub/failures').expect(200);

      expect(Object.keys(listed.body)).toEqual(['a']);

      await http.delete('/stub/failures/a').expect(200, { cleared: 'a' });
      await http.delete('/stub/failures').expect(200, { cleared: 0 });
    });
  });

  describe('sessions scope a rule to one run', () => {
    it('answers only a request that carries the session header', async () => {
      await http
        .post('/stub/rules')
        .send({
          path: '/v2/orders',
          sessionId: 'run-1',
          body: { run: 'run-1' },
        })
        .expect(201);

      await http.get('/v2/orders').expect(404);
      await http.get('/v2/orders').set(SESSION_HEADER, 'run-2').expect(404);
      await http
        .get('/v2/orders')
        .set(SESSION_HEADER, 'run-1')
        .expect(200, { run: 'run-1' });
    });

    it('clears one run without touching another', async () => {
      await http
        .post('/stub/rules')
        .send({ path: '/v2/a', sessionId: 'run-1' })
        .expect(201);
      await http
        .post('/stub/rules')
        .send({ path: '/v2/b', sessionId: 'run-2' })
        .expect(201);

      await http
        .delete('/stub/rules?sessionId=run-1')
        .expect(200, { cleared: 1 });

      const remaining = await http.get('/stub/rules').expect(200);

      expect(remaining.body).toHaveLength(1);
      expect(remaining.body[0].sessionId).toBe('run-2');
    });
  });

  describe('a bad rule is refused with every reason', () => {
    it('answers 400 and names the fields that are wrong', async () => {
      const response = await http
        .post('/stub/rules')
        .send({ path: 'not-absolute', method: 'TRACE', status: 999 })
        .expect(400);

      expect(JSON.stringify(response.body)).toContain('path must be a string');
      expect(JSON.stringify(response.body)).toContain('method must be one of');
      expect(JSON.stringify(response.body)).toContain(
        'status must be an integer',
      );
    });

    it('answers 404 when deleting a rule that is not installed', async () => {
      await http.delete('/stub/rules/not-a-rule').expect(404);
    });
  });
});
