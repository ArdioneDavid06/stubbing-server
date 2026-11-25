import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'node:path';
import type { StubPreset } from '../core/preset.types';
import type { StubModuleOptions } from '../core/stub-options';
import { SESSION_HEADER, RULE_HEADER, KEY_HEADER } from '../core/constants';
import { StubModule } from './stub.module';

/** How the standalone container is configured. */
export interface StubServerOptions extends StubModuleOptions {
  /** Defaults to 4010. Use 0 to let the OS choose, which is what tests do. */
  port?: number;
  host?: string;
  /** Request body limit. Defaults to 5mb, because a partner fixture can be large. */
  bodyLimit?: string;
}

/**
 * Build the app without listening. Useful when a caller wants to mount it inside an
 * existing NestJS application rather than start a second process.
 */
export async function createStubServer(
  options: StubServerOptions = {},
): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    StubModule.forRoot(options),
    // Nest's own parser is 100kb. A partner's example response can be bigger than
    // that, and a stub that refuses to record a body is a stub that lies about what
    // the application sent.
    { bodyParser: false },
  );

  const limit = options.bodyLimit ?? '5mb';

  app.useBodyParser('json', { limit });
  app.useBodyParser('urlencoded', { limit, extended: true });

  // The application under test is usually in another container, reached by service
  // name. Nothing here holds a secret, so there is nothing for CORS to protect.
  app.enableCors();

  return app;
}

export interface RunningStub {
  app: NestExpressApplication;
  /** Reachable from the host, e.g. `http://127.0.0.1:4010`. */
  url: string;
  port: number;
  close: () => Promise<void>;
}

/** Build and listen, returning the URL. Intended for tests and for embedded use. */
export async function startStubServer(
  options: StubServerOptions = {},
): Promise<RunningStub> {
  const app = await createStubServer(options);

  if (options.host) {
    await app.listen(options.port ?? 0, options.host);
  } else {
    await app.listen(options.port ?? 0);
  }
  // `getUrl()` reports `[::1]` on some hosts; a caller pasting that into a base URL
  // gets a connection error that looks like the stub is down.
  const url = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  const port = Number(new URL(url).port);

  return { app, url, port, close: () => app.close() };
}

/**
 * Load a preset from a file path, so the container can be told what to serve without
 * being rebuilt.
 *
 * The module must export a `preset`, or export one as its default. Anything else is a
 * mistake worth failing loudly at startup rather than serving an empty stub.
 */
export function loadPreset(specifier: string): StubPreset {
  const resolved = path.isAbsolute(specifier)
    ? specifier
    : path.resolve(process.cwd(), specifier);

  let loaded: unknown;

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require(resolved);
  } catch (error) {
    throw new Error(
      `Could not load preset "${specifier}" from ${resolved}: ${(error as Error).message}`,
    );
  }

  const module = asRecord(loaded);
  const preset = module?.preset ?? module?.default ?? loaded;
  const candidate = asRecord(preset);

  if (!candidate || typeof candidate.name !== 'string') {
    throw new Error(
      `Preset "${specifier}" must export an object with a name; see definePreset()`,
    );
  }

  return preset as StubPreset;
}

/** What an operator needs to see at startup: what is served, and where. */
export function logBanner(port: number, presets: readonly StubPreset[]): void {
  const logger = new Logger('stub');

  logger.log(`listening on http://localhost:${port}`);
  logger.log('  rules      POST /stub/rules, GET, DELETE');
  logger.log('  failures   POST /stub/failures, GET, DELETE');
  logger.log('  recorder   GET /stub/requests?path=, DELETE');
  logger.log('  health     GET /health');
  logger.log(
    `  headers    ${SESSION_HEADER} scopes a rule, ${RULE_HEADER} names the rule that answered, ${KEY_HEADER} names a failure key`,
  );

  if (presets.length === 0) {
    logger.log('  presets    none: rules, failures and the recorder only');
    return;
  }

  for (const preset of presets) {
    logger.log(`  preset     ${preset.name}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object') {
    return undefined;
  }

  return value as Record<string, unknown>;
}
