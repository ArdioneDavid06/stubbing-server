import type { CommandContext } from '../context';
import { operationError } from '../errors';
import { fieldBlock } from '../utils/output';

/**
 * Stop the container this CLI manages, and only that one.
 *
 * A name that collides with somebody else's container is refused rather than
 * stopped: stopping a container this tool did not create is the kind of convenience
 * that ruins a stranger's afternoon.
 */
export async function stop(
  context: CommandContext,
  options: { remove?: boolean },
): Promise<number> {
  const { config, docker, out } = context;
  const existing = await docker.inspect(config.containerName);

  if (!existing) {
    out.info(`nothing to stop: no container named "${config.containerName}"`);

    return 0;
  }

  if (existing.labels['com.rmc.stubbing.managed'] !== 'true') {
    throw operationError(
      `container "${config.containerName}" exists but was not created by this CLI`,
      'Refusing to stop it. Choose a different --name, or stop it with docker yourself.',
    );
  }

  if (existing.status === 'running') {
    const stopped = await docker.stopContainer(config.containerName);

    if (stopped.code !== 0) {
      throw operationError(
        `could not stop "${config.containerName}"`,
        stopped.stderr || stopped.stdout,
      );
    }

    out.info(`stopped "${config.containerName}"`);
  } else {
    out.info(`"${config.containerName}" was already ${existing.status}`);
  }

  if (options.remove) {
    const removed = await docker.removeContainer(config.containerName);

    if (removed.code !== 0) {
      throw operationError(
        `could not remove "${config.containerName}"`,
        removed.stderr || removed.stdout,
      );
    }

    out.info(`removed "${config.containerName}"`);
  }

  out.success(
    fieldBlock([
      ['name', config.containerName],
      ['state', options.remove ? 'removed' : 'stopped'],
    ]),
  );

  return 0;
}
