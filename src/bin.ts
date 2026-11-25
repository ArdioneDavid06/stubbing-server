#!/usr/bin/env node
import 'reflect-metadata';
import { logBanner, loadPreset, startStubServer } from './app/container';
import type { StubPreset } from './core/preset.types';

const USAGE = `
@rmc/stubbing - a stub server for third-party APIs

Usage
  stub-server [options]

Options
  -p, --port <port>     port to listen on (default 4010, or $STUB_PORT)
      --host <host>     interface to bind (default all, or $STUB_HOST)
      --preset <path>   load a preset module; repeatable, or $STUB_PRESETS (comma separated)
  -h, --help            show this text
  -v, --version         print the version

Endpoints
  POST   /stub/rules       install a rule; both the flat and the long shape
  GET    /stub/rules       what is installed, in match order
  DELETE /stub/rules       remove every rule

  POST   /stub/failures    make one call fail, keyed on an identifier
  GET    /stub/failures    what is installed
  DELETE /stub/failures    clear every failure

  GET    /stub/requests    what the application actually sent, 404s included
  DELETE /stub/requests    clear the recorder

  GET    /health           liveness
`;

interface CliOptions {
  port: number;
  host: string | undefined;
  presets: StubPreset[];
}

function main(): void {
  const argv = process.argv.slice(2);
  const port = numberFrom(process.env.STUB_PORT) ?? 4010;
  const host = process.env.STUB_HOST || undefined;
  const presetSpecs = splitList(process.env.STUB_PRESETS);
  const options: CliOptions = { port, host, presets: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    switch (arg) {
      case '-h':
      case '--help':
        process.stdout.write(`${USAGE.trim()}\n`);
        return;

      case '-v':
      case '--version':
        process.stdout.write(`${version()}\n`);
        return;

      case '-p':
      case '--port': {
        const parsed = numberFrom(value);

        if (parsed === undefined) {
          fail(`--port needs a number, got "${value ?? ''}"`);
        }

        options.port = parsed;
        index += 1;
        break;
      }

      case '--host':
        if (!value) {
          fail('--host needs a value');
        }

        options.host = value;
        index += 1;
        break;

      case '--preset':
        if (!value) {
          fail('--preset needs a path');
        }

        presetSpecs.push(value);
        index += 1;
        break;

      default:
        fail(`unknown argument "${arg}"\n${USAGE.trim()}`);
    }
  }

  for (const spec of presetSpecs) {
    options.presets.push(loadPreset(spec));
  }

  void run(options);
}

async function run(options: CliOptions): Promise<void> {
  let stub: Awaited<ReturnType<typeof startStubServer>>;

  try {
    stub = await startStubServer({
      port: options.port,
      host: options.host,
      presets: options.presets,
    });
  } catch (error) {
    fail(`could not start: ${(error as Error).message}`);
  }

  logBanner(stub.port, options.presets);

  // A container is stopped with a signal. Closing lets in-flight requests finish, so a
  // test that is mid-assertion sees a connection reset rather than a truncated body.
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void stub.close().then(() => process.exit(0));
    });
  }
}

function version(): string {
  try {
    // dist/bin.js sits beside package.json, which is the one place the version lives.
    return String((require('../package.json') as { version: string }).version);
  } catch {
    return 'unknown';
  }
}

function numberFrom(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 65535
    ? parsed
    : undefined;
}

function splitList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

main();
