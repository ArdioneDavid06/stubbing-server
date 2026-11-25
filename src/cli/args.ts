import { usageError } from './errors';

export const COMMANDS = [
  'start',
  'stop',
  'status',
  'logs',
  'pull',
  'version',
] as const;

export type CommandName = (typeof COMMANDS)[number];

/** Normalised options. `--image-tag` becomes `imageTag`, `--no-pull` becomes `noPull`. */
export interface CliOptions {
  config?: string;
  port?: string;
  host?: string;
  name?: string;
  image?: string;
  imageTag?: string;
  timeout?: string;
  tail?: string;
  pull?: boolean;
  noPull?: boolean;
  follow?: boolean;
  remove?: boolean;
  help?: boolean;
  version?: boolean;
}

export interface ParsedArgs {
  command?: CommandName;
  options: CliOptions;
}

/** Which options take a value. Everything else is a switch. */
const VALUED = new Set([
  'config',
  'port',
  'host',
  'name',
  'image',
  'image-tag',
  'timeout',
  'tail',
]);

const SWITCHES = new Set([
  'pull',
  'no-pull',
  'follow',
  'remove',
  'help',
  'version',
]);

/** Keys are without dashes: `splitOption` strips them before the lookup. */
const ALIASES: Record<string, string> = {
  h: 'help',
  v: 'version',
  f: 'follow',
  c: 'config',
  p: 'port',
};

/** Which options each command accepts, so `logs --port 1` is a usage error, not a no-op. */
const ALLOWED: Record<CommandName, ReadonlySet<string>> = {
  start: new Set([
    'config',
    'port',
    'host',
    'name',
    'image',
    'image-tag',
    'timeout',
    'pull',
    'no-pull',
    'help',
  ]),
  stop: new Set(['config', 'name', 'remove', 'help']),
  status: new Set(['config', 'name', 'help']),
  logs: new Set(['config', 'name', 'follow', 'tail', 'help']),
  pull: new Set(['config', 'image', 'image-tag', 'help']),
  version: new Set(['config', 'help']),
};

/**
 * Parse argv. No dependencies, no shell, no guessing: an unknown flag is an error
 * rather than something silently ignored, because a typo in CI should not turn into
 * a stub running on the wrong port.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const options: CliOptions = {};
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--') {
      positionals.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith('-')) {
      positionals.push(arg);
      continue;
    }

    const [rawName, inlineValue] = splitOption(arg);
    const name = ALIASES[rawName] ?? rawName;

    if (VALUED.has(name)) {
      const value = inlineValue ?? argv[index + 1];

      if (value === undefined || value.startsWith('--')) {
        throw usageError(`--${name} needs a value`, `Try: --${name} <value>`);
      }

      if (inlineValue === undefined) {
        index += 1;
      }

      assign(options, name, value);
      continue;
    }

    if (SWITCHES.has(name)) {
      if (inlineValue !== undefined) {
        throw usageError(`--${name} does not take a value`);
      }

      if (name === 'version') {
        options.version = true;
        continue;
      }

      assign(options, name, true);
      continue;
    }

    throw usageError(
      `unknown option "${arg}"`,
      'Run "stubbing-server --help" for the list.',
    );
  }

  if (positionals.length > 1) {
    throw usageError(
      `expected one command, got "${positionals.join(' ')}"`,
      'Run "stubbing-server --help" for the list.',
    );
  }

  const command = positionals[0];

  if (command !== undefined && !isCommand(command)) {
    throw usageError(
      `unknown command "${command}"`,
      `Known commands: ${COMMANDS.join(', ')}`,
    );
  }

  if (command !== undefined) {
    assertAllowed(command, options);
  }

  return { command, options };
}

function isCommand(value: string): value is CommandName {
  return (COMMANDS as readonly string[]).includes(value);
}

function assertAllowed(command: CommandName, options: CliOptions): void {
  const allowed = ALLOWED[command];

  for (const key of Object.keys(options)) {
    if (!allowed.has(kebab(key))) {
      throw usageError(
        `--${kebab(key)} is not an option of "${command}"`,
        `Allowed: ${[...allowed].map((name) => `--${name}`).join(', ')}`,
      );
    }
  }
}

function splitOption(arg: string): [string, string | undefined] {
  const withoutDashes = arg.replace(/^--?/, '');
  const equals = withoutDashes.indexOf('=');

  if (equals === -1) {
    return [withoutDashes, undefined];
  }

  return [withoutDashes.slice(0, equals), withoutDashes.slice(equals + 1)];
}

function assign(
  options: CliOptions,
  name: string,
  value: string | boolean,
): void {
  const key = camel(name) as keyof CliOptions;

  // A second `--name` is a mistake, not an override: last-wins hides it.
  if (options[key] !== undefined) {
    throw usageError(`--${name} was given twice`);
  }

  (options as Record<string, string | boolean>)[key] = value;
}

function camel(name: string): string {
  return name.replace(/-([a-z])/g, (_match, letter: string) =>
    letter.toUpperCase(),
  );
}

function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}
