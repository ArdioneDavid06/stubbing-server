import type { CommandContext } from '../context';
import { operationError } from '../errors';

/**
 * The container's output.
 *
 * `--follow` is off by default: in a pipeline, a command that never returns is a
 * command that hangs the job. When it is on, the child writes straight to this
 * terminal, so Ctrl-C reaches Docker rather than buffering for a minute first.
 */
export async function logs(
  context: CommandContext,
  options: { follow?: boolean; tail?: string },
): Promise<number> {
  const { config, docker, out } = context;
  const existing = await docker.inspect(config.containerName);

  if (!existing) {
    throw operationError(
      `no container named "${config.containerName}"`,
      'Run "stubbing-server start" first.',
    );
  }

  const tail = parseTail(options.tail);

  if (!options.follow) {
    out.info(`(${config.containerName}, last ${tail} lines)`);
  }

  const result = await docker.logs(config.containerName, {
    follow: options.follow,
    tail,
    stream: true,
  });

  if (result.code !== 0) {
    throw operationError(
      `could not read the logs of "${config.containerName}"`,
      result.stderr || result.stdout,
    );
  }

  return 0;
}

function parseTail(value: string | undefined): number {
  if (value === undefined) {
    return 200;
  }

  if (!/^[0-9]+$/.test(value)) {
    throw operationError(`--tail needs a whole number, got "${value}"`);
  }

  return Number(value);
}
