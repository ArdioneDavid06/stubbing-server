import type { CommandContext } from '../context';
import { imageRef } from '../docker/container-manager';
import { probeHealth } from '../utils/health';
import { fieldBlock } from '../utils/output';
import { url } from './start';

/**
 * What is on the machine right now, in the order a person debugging a red pipeline
 * wants it: is it running, what is it running, is it answering.
 */
export async function status(context: CommandContext): Promise<number> {
  const { config, docker, out } = context;
  const existing = await docker.inspect(config.containerName);

  if (!existing) {
    out.info(
      [
        `no container named "${config.containerName}"`,
        fieldBlock([
          ['image', imageRef(config)],
          ['would listen', url(config)],
          ['start', 'npx stubbing-server start'],
        ]),
      ].join('\n'),
    );

    return 0;
  }

  const health =
    existing.status === 'running'
      ? await probeHealth(config.host, config.port, config.healthcheck.path)
      : { ok: false, detail: 'not running' };

  out.info(
    [
      `stubbing-server: ${existing.status}`,
      fieldBlock([
        ['name', existing.name || config.containerName],
        ['id', existing.id.slice(0, 12)],
        ['image', existing.image || imageRef(config)],
        ['state', existing.status],
        ['health', health.ok ? 'ok' : health.detail],
        ['url', existing.status === 'running' ? url(config) : undefined],
        ['port', `${config.host}:${config.port} -> ${config.containerPort}`],
        ['mocks', config.mocksPath],
      ]),
    ].join('\n'),
  );

  if (existing.status !== 'running') {
    out.warn(
      [
        'Hint: the container exists but is not running.',
        '  npx stubbing-server start    start it again',
        '  npx stubbing-server logs     see why it stopped',
      ].join('\n'),
    );
    return 0;
  }

  if (!health.ok) {
    out.warn(
      [
        `Hint: running, but ${config.healthcheck.path} answered ${health.detail}.`,
        '  npx stubbing-server logs     what the server said',
        '  npx stubbing-server stop --remove && npx stubbing-server start',
      ].join('\n'),
    );
  }

  return 0;
}
