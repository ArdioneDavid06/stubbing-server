import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CliOptions } from '../args';
import { usageError } from '../errors';
import type { HealthcheckConfig, PullPolicy, StubConfig } from './defaults';

/**
 * A config file is a document a team reviews, so it is validated strictly: an
 * unknown key is an error, because `"prot": 4010` silently starting on 4010 and
 * failing two steps later is worse than a message that says which line is wrong.
 */
const FILE_KEYS = new Set([
  'image',
  'imageTag',
  'containerName',
  'host',
  'port',
  'containerPort',
  'healthcheck',
  'mocksPath',
  'environment',
  'pull',
]);

const HEALTH_KEYS = new Set(['path', 'timeoutMs', 'intervalMs']);

const IMAGE_PATTERN =
  /^[a-z0-9]([a-z0-9._-]*)(:[0-9]{1,5})?(\/[a-z0-9]([a-z0-9._-]*))*$/;
const TAG_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Pull the known fields out of a parsed JSON document, or explain why it cannot. */
export function validateFileConfig(
  raw: unknown,
  where: string,
): Partial<StubConfig> {
  const record = asRecord(raw);

  if (!record) {
    throw usageError(`${where} must contain a JSON object`);
  }

  for (const key of Object.keys(record)) {
    if (!FILE_KEYS.has(key)) {
      throw usageError(
        `${where}: unknown key "${key}"`,
        `Known keys: ${[...FILE_KEYS].join(', ')}`,
      );
    }
  }

  const config: Partial<StubConfig> = {};

  if ('image' in record) {
    config.image = requireString(record.image, 'image', where);

    if (!IMAGE_PATTERN.test(config.image)) {
      throw usageError(
        `${where}: "image" must look like ghcr.io/owner/name, with no tag and no scheme`,
      );
    }
  }

  if ('imageTag' in record) {
    config.imageTag = requireString(record.imageTag, 'imageTag', where);

    if (!TAG_PATTERN.test(config.imageTag)) {
      throw usageError(
        `${where}: "imageTag" contains characters a Docker tag cannot`,
      );
    }

    // A tag is a promise that the thing you ran is the thing you shipped.
    if (config.imageTag === 'latest') {
      throw usageError(
        `${where}: "imageTag" must pin a version, not use "latest"`,
        'Local and CI runs of a moving tag are not the same run twice.',
      );
    }
  }

  if ('containerName' in record) {
    config.containerName = requireString(
      record.containerName,
      'containerName',
      where,
    );

    if (!CONTAINER_NAME_PATTERN.test(config.containerName)) {
      throw usageError(
        `${where}: "containerName" may contain letters, digits, "_", "." and "-"`,
      );
    }

    if (config.containerName.length > 63) {
      throw usageError(
        `${where}: "containerName" must be 63 characters or fewer`,
      );
    }
  }

  if ('host' in record) {
    config.host = requireString(record.host, 'host', where);

    if (!/^[A-Za-z0-9.:[\]-]+$/.test(config.host)) {
      throw usageError(`${where}: "host" must be an address, not a URL`);
    }
  }

  if ('port' in record) {
    config.port = requirePort(record.port, 'port', where);
  }

  if ('containerPort' in record) {
    config.containerPort = requirePort(
      record.containerPort,
      'containerPort',
      where,
    );
  }

  if ('healthcheck' in record) {
    config.healthcheck = validateHealthcheck(record.healthcheck, where);
  }

  if ('mocksPath' in record) {
    config.mocksPath = requireString(record.mocksPath, 'mocksPath', where);
  }

  if ('environment' in record) {
    config.environment = validateEnvironment(record.environment, where);
  }

  if ('pull' in record) {
    config.pull = requirePull(record.pull, where);
  }

  return config;
}

/**
 * Apply the flags that were given. Everything else keeps the value from the file or
 * from the defaults, which is the documented precedence.
 */
export function applyOverrides(
  base: StubConfig,
  options: CliOptions,
): StubConfig {
  const config: StubConfig = {
    ...base,
    healthcheck: { ...base.healthcheck },
    environment: { ...base.environment },
  };

  if (options.port !== undefined) {
    config.port = parsePort(options.port, '--port');
  }

  if (options.host !== undefined) {
    config.host = options.host;
  }

  if (options.name !== undefined) {
    config.containerName = options.name;

    if (!CONTAINER_NAME_PATTERN.test(options.name)) {
      throw usageError('--name may contain letters, digits, "_", "." and "-"');
    }
  }

  if (options.image !== undefined) {
    config.image = options.image;

    if (!IMAGE_PATTERN.test(config.image)) {
      throw usageError(
        '--image must look like ghcr.io/owner/name, with no tag',
      );
    }
  }

  if (options.imageTag !== undefined) {
    if (!TAG_PATTERN.test(options.imageTag)) {
      throw usageError('--image-tag contains characters a Docker tag cannot');
    }

    if (options.imageTag === 'latest') {
      throw usageError('--image-tag latest is not reproducible; pin a version');
    }

    config.imageTag = options.imageTag;
  }

  if (options.timeout !== undefined) {
    config.healthcheck.timeoutMs = parseTimeout(options.timeout);
  }

  if (options.pull && options.noPull) {
    throw usageError('--pull and --no-pull are opposites; pick one');
  }

  if (options.pull) {
    config.pull = 'always';
  }

  if (options.noPull) {
    config.pull = 'never';
  }

  return config;
}

/**
 * A mocks directory that does not exist would otherwise be created as an empty
 * directory by Docker, and the run would be green with no rules installed.
 */
export function assertMocksPath(config: StubConfig): void {
  if (config.mocksPath === undefined) {
    return;
  }

  const resolved = path.resolve(config.mocksPath);

  if (resolved === path.parse(resolved).root) {
    throw usageError(
      'mocksPath must not be the filesystem root; point it at a directory of rules',
    );
  }

  let stats: fs.Stats;

  try {
    stats = fs.statSync(resolved);
  } catch {
    throw usageError(`mocksPath does not exist: ${config.mocksPath}`);
  }

  if (!stats.isDirectory()) {
    throw usageError(`mocksPath is not a directory: ${config.mocksPath}`);
  }
}

function validateHealthcheck(raw: unknown, where: string): HealthcheckConfig {
  const record = asRecord(raw);

  if (!record) {
    throw usageError(`${where}: "healthcheck" must be an object`);
  }

  for (const key of Object.keys(record)) {
    if (!HEALTH_KEYS.has(key)) {
      throw usageError(`${where}: unknown key "healthcheck.${key}"`);
    }
  }

  const config = {} as HealthcheckConfig;

  if ('path' in record) {
    config.path = requireString(record.path, 'healthcheck.path', where);

    if (!config.path.startsWith('/')) {
      throw usageError(`${where}: "healthcheck.path" must start with "/"`);
    }
  }

  if ('timeoutMs' in record) {
    config.timeoutMs = requireInteger(
      record.timeoutMs,
      'healthcheck.timeoutMs',
      where,
      1_000,
      600_000,
    );
  }

  if ('intervalMs' in record) {
    config.intervalMs = requireInteger(
      record.intervalMs,
      'healthcheck.intervalMs',
      where,
      100,
      10_000,
    );
  }

  return config;
}

function validateEnvironment(
  raw: unknown,
  where: string,
): Record<string, string> {
  const record = asRecord(raw);

  if (!record) {
    throw usageError(`${where}: "environment" must be an object of strings`);
  }

  const environment: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      throw usageError(
        `${where}: "environment" key "${key}" is not a valid variable name`,
      );
    }

    if (typeof value !== 'string') {
      throw usageError(
        `${where}: "environment.${key}" must be a string; numbers look like typos`,
      );
    }

    if (value.includes('\n') || value.includes('\r')) {
      throw usageError(`${where}: "environment.${key}" must be one line`);
    }

    if (key === 'STUB_PORT') {
      // The published port and the listening port would disagree, and the only
      // symptom is a health probe that never answers.
      throw usageError(
        `${where}: set "containerPort" instead of environment.STUB_PORT`,
      );
    }

    environment[key] = value;
  }

  return environment;
}

function requirePull(raw: unknown, where: string): PullPolicy {
  if (raw === 'missing' || raw === 'always' || raw === 'never') {
    return raw;
  }

  throw usageError(`${where}: "pull" must be "missing", "always" or "never"`);
}

function requireString(raw: unknown, field: string, where: string): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw usageError(`${where}: "${field}" must be a non-empty string`);
  }

  return raw.trim();
}

function requirePort(raw: unknown, field: string, where: string): number {
  return requireInteger(raw, field, where, 1, 65_535);
}

function requireInteger(
  raw: unknown,
  field: string,
  where: string,
  minimum: number,
  maximum: number,
): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw)) {
    throw usageError(`${where}: "${field}" must be a whole number`);
  }

  if (raw < minimum || raw > maximum) {
    throw usageError(
      `${where}: "${field}" must be between ${minimum} and ${maximum}`,
    );
  }

  return raw;
}

function parsePort(value: string, field: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw usageError(`${field} needs a whole number, got "${value}"`);
  }

  return requireInteger(Number(value), field, 'the command line', 1, 65_535);
}

function parseTimeout(value: string): number {
  if (!/^[0-9]+$/.test(value)) {
    throw usageError(`--timeout needs milliseconds, got "${value}"`);
  }

  return requireInteger(
    Number(value),
    '--timeout',
    'the command line',
    1_000,
    600_000,
  );
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
