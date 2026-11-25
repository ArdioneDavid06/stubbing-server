/**
 * The configuration a consuming repository commits, and the defaults it does not
 * have to write.
 *
 * Precedence, in one direction: CLI options > project config > defaults here. A
 * value that is not in any of those has to have a safe default, because the common
 * invocation is `npx stubbing-server start` with no arguments at all.
 */

export interface HealthcheckConfig {
  /** Path probed on the host port until the server answers. */
  path: string;
  /** Give up after this long, and print the container's logs. */
  timeoutMs: number;
  /** Time between probes. */
  intervalMs: number;
}

export type PullPolicy = 'missing' | 'always' | 'never';

export interface StubConfig {
  /** Registry and repository, without a tag: `ghcr.io/owner/stubbing-server`. */
  image: string;
  /** Immutable version. `latest` is rejected on purpose. */
  imageTag: string;
  /** The container this CLI manages, and only this one. */
  containerName: string;
  /** Host interface to publish on. Local by default: a stub is not a public service. */
  host: string;
  /** Host port the tests talk to. */
  port: number;
  /** Port the server listens on inside the container. */
  containerPort: number;
  healthcheck: HealthcheckConfig;
  /** Directory of `*.json` rules seeded at startup, mounted read-only. */
  mocksPath?: string;
  /** Extra environment for the container. Never logged. */
  environment: Record<string, string>;
  pull: PullPolicy;
}

/**
 * Derived from this package's scope (`@rmc/stubbing-server`). A fork, or a
 * different organisation, changes this one line — or sets `image` in its config.
 */
export const DEFAULT_IMAGE = 'ghcr.io/rmc/stubbing-server';

/** Kept in step with `package.json` at release time; `version` prints both. */
export const DEFAULT_IMAGE_TAG = '1.0.0';

export const DEFAULT_CONTAINER_NAME = 'stubbing-server';
export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4010;
export const DEFAULT_HEALTH_PATH = '/health';
export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;
export const DEFAULT_HEALTH_INTERVAL_MS = 500;

/** Where the mocks directory is mounted inside the container. */
export const MOCKS_MOUNT = '/stubs';

export function defaultConfig(): StubConfig {
  return {
    image: DEFAULT_IMAGE,
    imageTag: DEFAULT_IMAGE_TAG,
    containerName: DEFAULT_CONTAINER_NAME,
    host: DEFAULT_HOST,
    port: DEFAULT_PORT,
    containerPort: DEFAULT_PORT,
    healthcheck: {
      path: DEFAULT_HEALTH_PATH,
      timeoutMs: DEFAULT_HEALTH_TIMEOUT_MS,
      intervalMs: DEFAULT_HEALTH_INTERVAL_MS,
    },
    environment: {},
    pull: 'missing',
  };
}

/** The file a repository commits, next to its package.json. */
export const CONFIG_FILENAME = 'stubbing.config.json';
