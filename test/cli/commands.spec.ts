import type { CommandContext } from '../../src/cli/context';
import { defaultConfig } from '../../src/cli/config/defaults';
import { CliError } from '../../src/cli/errors';
import { start } from '../../src/cli/commands/start';
import { stop } from '../../src/cli/commands/stop';
import { status } from '../../src/cli/commands/status';
import { captureOut, containerDocument, fakeDocker } from './fakes';
import type { FakeDockerOptions } from './fakes';
import type { WaitResult } from '../../src/cli/utils/health';

const READY: WaitResult = {
  ok: true,
  attempts: 1,
  waitedMs: 5,
  lastDetail: 'HTTP 200',
};

function context(
  options: FakeDockerOptions = {},
  overrides: Partial<CommandContext> = {},
): CommandContext & { out: ReturnType<typeof captureOut> } {
  const fake = fakeDocker(options);
  const out = captureOut();

  return {
    config: defaultConfig(),
    docker: fake.docker,
    out,
    version: '1.0.0',
    health: async () => READY,
    portFree: async () => true,
    ...overrides,
  } as CommandContext & { out: ReturnType<typeof captureOut> };
}

async function failureOf(action: Promise<unknown>): Promise<CliError> {
  try {
    await action;
  } catch (error) {
    return error as CliError;
  }

  throw new Error('expected the command to fail');
}

describe('start', () => {
  it('creates a container, waits for health, and prints the url', async () => {
    const ctx = context({ container: null });
    const code = await start(ctx);

    expect(code).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain(
      'stubbing-server is up (started)',
    );
    expect(ctx.out.lines.join('\n')).toContain('http://127.0.0.1:4010');
  });

  it('reuses a container that is already running, without running another', async () => {
    const ctx = context({ container: containerDocument({}) });
    const code = await start(ctx);

    expect(code).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('(reused)');
  });

  it('starts an existing container that is stopped', async () => {
    const ctx = context({ container: containerDocument({ status: 'exited' }) });
    const code = await start(ctx);

    expect(code).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain(
      'starting the existing container',
    );
  });

  it('refuses to replace a container built from another image', async () => {
    const ctx = context({
      container: containerDocument({
        image: 'ghcr.io/ardionedavid06/stubbing-server:0.9.0',
      }),
    });
    const error = await failureOf(start(ctx));

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('0.9.0');
    expect(error.hint).toContain('stop --remove');
  });

  it('refuses to start when the port is taken, before docker runs anything', async () => {
    const ctx = context({ container: null }, { portFree: async () => false });
    const error = await failureOf(start(ctx));

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('port 4010');
  });

  it('pulls the image when it is missing', async () => {
    const ctx = context({ container: null, imagePresent: false });
    await start(ctx);

    expect(ctx.out.lines.join('\n')).toContain(
      'pulling ghcr.io/ardionedavid06/stubbing-server:1.0.0',
    );
  });

  it('refuses to pull when pulling is disabled', async () => {
    const ctx = context({ container: null, imagePresent: false });

    ctx.config.pull = 'never';

    const error = await failureOf(start(ctx));

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('is not on this machine');
  });

  it('explains a registry refusal instead of dying with docker prose', async () => {
    const ctx = context({
      container: null,
      imagePresent: false,
      pullError: 'unauthorized: authentication required',
    });
    const error = await failureOf(start(ctx));

    expect(error.hint).toContain('docker login ghcr.io');
  });

  it('fails with the container output when health never comes up', async () => {
    const ctx = context(
      { container: null, logs: '[stub] boom' },
      {
        health: async () => ({
          ok: false,
          attempts: 30,
          waitedMs: 60_000,
          lastDetail: 'ECONNREFUSED',
        }),
      },
    );
    const error = await failureOf(start(ctx));

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('did not answer /health');
    expect(ctx.out.lines.join('\n')).toContain('[stub] boom');
  });

  it('stops before creating anything when Docker is not running', async () => {
    const ctx = context({ daemon: false });
    const error = await failureOf(start(ctx));

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('Docker is not usable');
    expect(error.hint).toContain('Start Docker Desktop');
  });
});

describe('stop', () => {
  it('says so when there is nothing to stop, and succeeds', async () => {
    const ctx = context({ container: null });

    expect(await stop(ctx, {})).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('nothing to stop');
  });

  it('refuses a container it did not create', async () => {
    const ctx = context({ container: containerDocument({ labels: {} }) });
    const error = await failureOf(stop(ctx, {}));

    expect(error.exitCode).toBe(1);
    expect(error.message).toContain('was not created by this CLI');
  });

  it('stops a running container it manages', async () => {
    const ctx = context({ container: containerDocument({}) });

    expect(await stop(ctx, {})).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('stopped "stubbing-server"');
  });

  it('is idempotent for a container that is already stopped', async () => {
    const ctx = context({ container: containerDocument({ status: 'exited' }) });

    expect(await stop(ctx, {})).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('already exited');
  });

  it('removes the container when asked', async () => {
    const ctx = context({ container: containerDocument({ status: 'exited' }) });

    expect(await stop(ctx, { remove: true })).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('removed "stubbing-server"');
  });
});

describe('status', () => {
  it('reports that nothing exists yet, with the command that would', async () => {
    const ctx = context({ container: null });

    expect(await status(ctx)).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('no container named');
    expect(ctx.out.lines.join('\n')).toContain('npx stubbing-server start');
  });

  it('reports a running container', async () => {
    const ctx = context({ container: containerDocument({}) });

    expect(await status(ctx)).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('stubbing-server: running');
  });

  it('reports a stopped container with the hint that fixes it', async () => {
    const ctx = context({ container: containerDocument({ status: 'exited' }) });

    expect(await status(ctx)).toBe(0);
    expect(ctx.out.lines.join('\n')).toContain('stubbing-server: exited');
    expect(ctx.out.lines.join('\n')).toContain('npx stubbing-server start');
  });
});
