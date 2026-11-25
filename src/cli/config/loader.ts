import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CliOptions } from '../args';
import { usageError } from '../errors';
import { CONFIG_FILENAME, defaultConfig } from './defaults';
import type { StubConfig } from './defaults';
import {
  applyOverrides,
  assertMocksPath,
  validateFileConfig,
} from './validator';

export interface LoadedConfig {
  config: StubConfig;
  /** The file it came from. Undefined when only defaults and flags applied. */
  configPath?: string;
}

/**
 * Read the project's config, then let flags win over it, then check what came out.
 *
 * The order is the documented precedence: CLI options > project config > defaults.
 */
export function loadConfig(
  options: CliOptions,
  cwd: string = process.cwd(),
): LoadedConfig {
  const explicit = options.config;
  const candidate = explicit
    ? path.resolve(cwd, explicit)
    : path.join(cwd, CONFIG_FILENAME);
  const exists = fs.existsSync(candidate);

  if (explicit && !exists) {
    throw usageError(`config file not found: ${explicit}`);
  }

  const base = defaultConfig();
  let partial: Partial<StubConfig> = {};
  const configPath = exists ? candidate : undefined;

  if (configPath) {
    partial = validateFileConfig(
      readJson(configPath),
      display(configPath, cwd),
    );

    if (partial.mocksPath !== undefined) {
      // Relative to the config file, not to wherever the command was run from: a
      // config checked into a repo must not change meaning in a subdirectory.
      partial.mocksPath = path.resolve(
        path.dirname(configPath),
        partial.mocksPath,
      );
    }
  }

  const config = applyOverrides(merge(base, partial), options);

  assertMocksPath(config);

  return { config, configPath };
}

function merge(base: StubConfig, partial: Partial<StubConfig>): StubConfig {
  return {
    ...base,
    ...partial,
    healthcheck: { ...base.healthcheck, ...(partial.healthcheck ?? {}) },
    environment: { ...base.environment, ...(partial.environment ?? {}) },
  };
}

function readJson(filePath: string): unknown {
  let text: string;

  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    throw usageError(`could not read ${filePath}: ${(error as Error).message}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw usageError(
      `${filePath} is not valid JSON: ${(error as Error).message}`,
    );
  }
}

/** A path inside the working directory is clearer relative; anything else is absolute. */
function display(filePath: string, cwd: string): string {
  const relative = path.relative(cwd, filePath);

  return relative.startsWith('..') || path.isAbsolute(relative)
    ? filePath
    : relative;
}
