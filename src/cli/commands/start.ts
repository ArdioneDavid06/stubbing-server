import { healthOf, portFreeOf, type CommandContext } from '../context';
import { imageRef, planFor, runArgs } from '../docker/container-manager';
import { operationError } from '../errors';
import { fieldBlock } from '../utils/output';

/**
 * Start the stub, or reuse the one that is already running.
 *
 * Every step that can fail says what it was trying to do and what to try next: a CI
 * log with "exit status 1" and nothing else costs more time than writing this cost.
 */
export async function start(context: CommandContext): Promise<number> {
  const { config, docker, out, version } = context;
  const daemon = await docker.daemonStatus();

  if (!daemon.ok) {
    throw operationError(
      'Docker is not usable',
      `${daemon.detail}\n  Start Docker Desktop (or the Docker daemon), then run this again.`,
    );
  }

  const ref = imageRef(config);
  const existing = await docker.inspect(config.containerName);
  const plan = planFor(existing, config);

  if (plan.action === 'conflict') {
    throw operationError(
      `container "${config.containerName}" already exists: ${plan.reason}`,
      `Run "stubbing-server stop --remove", or start with a different --name.`,
    );
  }

  if (plan.action === 'reuse') {
    await assertHealthy(context, existing?.id);
    report(context, 'reused', existing?.id);

    return 0;
  }

  if (plan.action === 'start') {
    out.info(`starting the existing container "${config.containerName}" ...`);

    const started = await docker.startContainer(config.containerName);

    if (started.code !== 0) {
      throw operationError(
        `could not start "${config.containerName}"`,
        started.stderr || started.stdout,
      );
    }
  }

  if (plan.action === 'create') {
    await ensureImage(context, ref);
    await ensurePortFree(context);

    const created = await docker.run(runArgs(config, { version }));

    if (created.code !== 0) {
      throw operationError(
        'could not start the container',
        created.stderr || created.stdout,
      );
    }
  }

  await assertHealthy(context, existing?.id);
  report(context, 'started', existing?.id);

  return 0;
}

async function ensureImage(
  context: CommandContext,
  ref: string,
): Promise<void> {
  const { config, docker, out } = context;
  const present = await docker.imageExists(ref);

  if (!present && config.pull === 'never') {
    throw operationError(
      `image ${ref} is not on this machine and pulling is disabled`,
      `Run "stubbing-server pull", or drop --no-pull.`,
    );
  }

  if (!present || config.pull === 'always') {
    out.info(`pulling ${ref} ...`);

    const pulled = await docker.pull(ref);

    if (pulled.code !== 0) {
      throw operationError(
        `could not pull ${ref}`,
        authHint(`${pulled.stderr}\n${pulled.stdout}`),
      );
    }
  }
}

async function ensurePortFree(context: CommandContext): Promise<void> {
  const { config, out } = context;
  const free = await portFreeOf(context)(config.host, config.port);

  if (!free) {
    throw operationError(
      `port ${config.port} on ${config.host} is already in use`,
      `Stop the process using it, or run "stubbing-server start --port ${config.port + 1}".`,
    );
  }

  out.info(`port ${config.port} is free on ${config.host}`);
}

async function assertHealthy(
  context: CommandContext,
  containerId: string | undefined,
): Promise<void> {
  const { config, docker, out } = context;
  const health = await healthOf(context)({
    host: config.host,
    port: config.port,
    path: config.healthcheck.path,
    timeoutMs: config.healthcheck.timeoutMs,
    intervalMs: config.healthcheck.intervalMs,
  });

  if (health.ok) {
    out.info(
      `ready after ${health.waitedMs}ms (${health.attempts} probe${health.attempts === 1 ? '' : 's'})`,
    );
    return;
  }

  // The container's own output is the only thing that explains a server that started
  // and never answered, so print it before the error.
  const logs = await docker.logs(config.containerName, { tail: 20 });

  for (const line of `${logs.stdout}\n${logs.stderr}`.split('\n')) {
    if (line.trim().length > 0) {
      out.error(`  | ${line}`);
    }
  }

  throw operationError(
    `the stub did not answer ${config.healthcheck.path} within ${config.healthcheck.timeoutMs}ms (last: ${health.lastDetail})`,
    containerId === undefined
      ? 'Run "stubbing-server logs" to see what the container said.'
      : `Container ${containerId.slice(0, 12)} is running; "stubbing-server logs" shows what it said.`,
  );
}

function report(
  context: CommandContext,
  how: 'started' | 'reused',
  containerId: string | undefined,
): void {
  const { config, out } = context;

  out.success(
    [
      `stubbing-server is up (${how})`,
      fieldBlock([
        ['url', url(config)],
        ['image', imageRef(config)],
        ['name', config.containerName],
        ['port', `${config.host}:${config.port} -> ${config.containerPort}`],
        ['mocks', config.mocksPath],
        ['id', containerId?.slice(0, 12)],
        ['stop', 'npx stubbing-server stop'],
      ]),
    ].join('\n'),
  );
}

export function url(config: { host: string; port: number }): string {
  const host =
    config.host === '0.0.0.0' || config.host === '::'
      ? '127.0.0.1'
      : config.host;

  return `http://${host}:${config.port}`;
}

/** A registry rejection with no next step is a support ticket. */
function authHint(detail: string): string {
  const lower = detail.toLowerCase();

  if (
    lower.includes('unauthorized') ||
    lower.includes('denied') ||
    lower.includes('401')
  ) {
    return `${detail}\n  The registry refused the pull. Log in first: echo "$GH_PACKAGES_TOKEN" | docker login ghcr.io -u <username> --password-stdin`;
  }

  if (lower.includes('manifest unknown') || lower.includes('not found')) {
    return `${detail}\n  Check the image and tag in stubbing.config.json.`;
  }

  return detail;
}
