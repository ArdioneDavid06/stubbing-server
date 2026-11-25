import type { StubConfig } from '../config/defaults';
import { MOCKS_MOUNT } from '../config/defaults';
import type { ContainerState } from './docker-client';

export function imageRef(config: StubConfig): string {
  return `${config.image}:${config.imageTag}`;
}

/**
 * What to do with what is already on the machine.
 *
 * A container with a different image or a different published port is a conflict,
 * not something to silently replace: it may be another repository's stub, and
 * `docker run` would fail on the name anyway with a message about a name already in
 * use rather than about the image.
 */
export type Plan =
  | { action: 'create' }
  | { action: 'start' }
  | { action: 'reuse' }
  | { action: 'conflict'; reason: string };

export function planFor(
  existing: ContainerState | undefined,
  config: StubConfig,
): Plan {
  if (!existing) {
    return { action: 'create' };
  }

  const wanted = imageRef(config);

  if (existing.image !== '' && existing.image !== wanted) {
    return {
      action: 'conflict',
      reason: `the container was created from ${existing.image}, but this config wants ${wanted}`,
    };
  }

  if (
    existing.status === 'running' &&
    existing.hostPort !== undefined &&
    existing.hostPort !== String(config.port)
  ) {
    return {
      action: 'conflict',
      reason: `the container publishes port ${existing.hostPort}, but this config wants ${config.port}`,
    };
  }

  return existing.status === 'running'
    ? { action: 'reuse' }
    : { action: 'start' };
}

/**
 * `docker run` arguments, as an array.
 *
 * Order is fixed and the environment is sorted, so the same config always produces
 * the same command — which is what makes it testable, and what makes a diff in a
 * log mean something.
 */
export function runArgs(
  config: StubConfig,
  options: { version: string },
): string[] {
  const labels = {
    'com.rmc.stubbing.managed': 'true',
    'com.rmc.stubbing.project': config.containerName,
    'com.rmc.stubbing.version': options.version,
  };

  const environment: Record<string, string> = {
    STUB_PORT: String(config.containerPort),
    ...config.environment,
  };

  if (environment.STUB_PORT !== String(config.containerPort)) {
    // The mapping and the listening port would disagree, and the health probe would
    // fail for a reason nobody would guess from the message.
    throw new Error(
      'environment.STUB_PORT conflicts with containerPort; set containerPort instead',
    );
  }

  const args = ['-d', '--name', config.containerName];

  for (const [key, value] of Object.entries(labels)) {
    args.push('--label', `${key}=${value}`);
  }

  args.push('-p', `${config.host}:${config.port}:${config.containerPort}`);

  if (config.mocksPath !== undefined) {
    // Read-only: a stub that can write into the rules it seeds is a stub that drifts
    // from the file a reviewer approved.
    args.push('-v', `${config.mocksPath}:${MOCKS_MOUNT}:ro`);
    args.push('-e', `STUB_MOCKS_DIR=${MOCKS_MOUNT}`);
  }

  for (const key of Object.keys(environment).sort()) {
    args.push('-e', `${key}=${environment[key]}`);
  }

  args.push(imageRef(config));

  return args;
}
