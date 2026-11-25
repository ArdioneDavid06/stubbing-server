#!/usr/bin/env node
import { parseArgs } from './args';
import type { CommandName } from './args';
import { loadConfig } from './config/loader';
import type { LoadedConfig } from './config/loader';
import { defaultConfig } from './config/defaults';
import { DockerClient } from './docker/docker-client';
import { CliError, usageError } from './errors';
import { consoleOut } from './utils/output';
import { cliVersion } from './version';
import { start } from './commands/start';
import { stop } from './commands/stop';
import { status } from './commands/status';
import { logs } from './commands/logs';
import { pull } from './commands/pull';
import { version } from './commands/version';
import type { CommandContext } from './context';

const HELP = `
@rmc/stubbing-server - run the stubbing server in Docker

Usage
  stubbing-server <command> [options]

Commands
  start      start the container, or reuse the one already running
  stop       stop the container this tool manages
  status     show state, image, port, url and health
  logs       print the container's output (--follow to stream)
  pull       pull the configured image
  version    print the CLI, image and config versions

Options
  -c, --config <path>   config file (default: ./stubbing.config.json)
  -p, --port <port>     host port to publish (default: 4010)
      --host <host>     host interface (default: 127.0.0.1)
      --name <name>     container name (default: stubbing-server)
      --image <ref>     image, without a tag
      --image-tag <tag> image version (default: the CLI's version)
      --timeout <ms>    how long to wait for /health (default: 60000)
      --pull            always pull; --no-pull never pulls
      --remove          with stop: remove the container too
  -f, --follow          with logs: stream instead of printing
      --tail <n>        with logs: how many lines (default: 200)
  -h, --help            this text
  -v, --version         print the CLI version

Precedence
  CLI options > project config > defaults

Examples
  npx stubbing-server start
  npx stubbing-server start --port 4011 --name orders-stub
  npx stubbing-server start --config ./stubbing.config.json --no-pull
  npx stubbing-server logs --follow
  npx stubbing-server stop --remove
`.trim();

export async function main(
  argv: string[] = process.argv.slice(2),
): Promise<number> {
  const out = consoleOut;

  try {
    const { command, options } = parseArgs(argv);

    if (options.help) {
      out.info(HELP);
      return 0;
    }

    if (options.version) {
      out.info(`stubbing-server ${cliVersion()}`);
      return 0;
    }

    if (!command) {
      out.error(HELP);
      return 2;
    }

    const loaded = loadFor(command, options, out);
    const context: CommandContext = {
      config: loaded.config,
      docker: new DockerClient(),
      out,
      version: cliVersion(),
    };

    // `return await`, not `return`: without it a rejection from the command skips this
    // try/catch and reaches the terminal as a stack trace instead of a message.
    switch (command) {
      case 'start':
        return await start(context);
      case 'stop':
        return await stop(context, { remove: options.remove });
      case 'status':
        return await status(context);
      case 'logs':
        return await logs(context, {
          follow: options.follow,
          tail: options.tail,
        });
      case 'pull':
        return await pull(context);
      case 'version':
        return await version(context, loaded.configPath ?? 'defaults');
      default:
        throw usageError(`unknown command "${String(command)}"`);
    }
  } catch (error) {
    if (error instanceof CliError) {
      out.error(error.message);

      if (error.hint) {
        out.error(error.hint);
      }

      return error.exitCode;
    }

    out.error(`unexpected error: ${(error as Error).message}`);
    return 1;
  }
}

/**
 * A broken config file should not stop a version check: `version` exists to answer
 * "what am I running", and that question survives a typo elsewhere.
 */
function loadFor(
  command: CommandName,
  options: Parameters<typeof loadConfig>[0],
  out: typeof consoleOut,
): LoadedConfig {
  try {
    return loadConfig(options);
  } catch (error) {
    if (command === 'version') {
      out.warn(
        `warning: ${(error as Error).message} (showing defaults instead)`,
      );

      return { config: defaultConfig() };
    }

    throw error;
  }
}

if (require.main === module) {
  void main()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error: unknown) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
}
