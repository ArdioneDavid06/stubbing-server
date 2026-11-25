import type { CommandContext } from '../context';
import { imageRef } from '../docker/container-manager';
import { fieldBlock } from '../utils/output';

/**
 * Three versions, because they are three different things and confusion between
 * them is how a bug report says "I'm on the latest" about all three.
 */
export async function version(
  context: CommandContext,
  source: string,
): Promise<number> {
  const { config, docker, out, version: cli } = context;
  const ref = imageRef(config);

  // A version check should work with Docker stopped, so this is best-effort.
  let imageLabel: string | undefined;

  try {
    imageLabel = await docker.imageVersionLabel(ref);
  } catch {
    imageLabel = undefined;
  }

  out.info(
    fieldBlock([
      ['cli', cli],
      ['image', ref],
      ['image version', imageLabel ?? 'not present locally'],
      ['config', source],
    ]),
  );

  return 0;
}
