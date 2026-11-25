import { Controller, Get, Param } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { definePreset } from '../src/core/preset.types';
import { StubModule } from '../src/app/stub.module';

/**
 * The seam, exercised: a partner is added as a preset, with a route and a key
 * location, and `core/` is not touched.
 *
 * The partner here is fictional on purpose. This package ships no real preset.
 */
@Controller('demo/widgets')
class WidgetsController {
  @Get(':id')
  get(@Param('id') id: string): { id: string; name: string } {
    return { id, name: 'sprocket' };
  }
}

const demoPreset = definePreset({
  name: 'demo',
  controllers: [WidgetsController],
  // This partner puts its identifier in the path, not in the body. Only the preset
  // knows that, which is why `keyOf` lives on the preset and not in core.
  keyOf: (incoming) => /^\/demo\/widgets\/([^/]+)$/.exec(incoming.path)?.[1],
});

describe('a preset mounts a partner without touching core', () => {
  let app: INestApplication;
  let http: request.Agent;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [StubModule.forRoot({ presets: [demoPreset] })],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    http = request(app.getHttpServer());
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await http.delete('/stub/rules').expect(200);
    await http.delete('/stub/failures').expect(200);
  });

  it('serves the preset route', async () => {
    await http
      .get('/demo/widgets/w-1')
      .expect(200, { id: 'w-1', name: 'sprocket' });
  });

  it('reads the failure key where the preset says it is', async () => {
    await http
      .post('/stub/failures')
      .send({ key: 'w-1', status: 409 })
      .expect(200);

    await http.get('/demo/widgets/w-1').expect(409);

    // One failure, one call: the preset route answers again afterwards.
    await http.get('/demo/widgets/w-1').expect(200);
  });

  it('lets a rule override a preset route, because rules run before the router', async () => {
    await http
      .post('/stub/rules')
      .send({
        method: 'GET',
        path: '/demo/widgets/:id',
        body: { from: 'rule' },
      })
      .expect(201);

    await http.get('/demo/widgets/w-2').expect(200, { from: 'rule' });
  });
});
