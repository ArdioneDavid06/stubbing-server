import type { CommandContext } from '../context';
import { imageRef } from '../docker/container-manager';
import { operationError } from '../errors';

/** Pull the configured image, and say exactly what was pulled. */
export async function pull(context: CommandContext): Promise<number> {
  const { config, docker, out } = context;
  const ref = imageRef(config);

  out.info(`pulling ${ref} ...`);

  const result = await docker.pull(ref);

  if (result.code !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`.trim();
    const lower = detail.toLowerCase();

    if (
      lower.includes('unauthorized') ||
      lower.includes('denied') ||
      lower.includes('401')
    ) {
      throw operationError(
        `the registry refused to serve ${ref}`,
        `${detail}\n  Log in first: echo "$GH_PACKAGES_TOKEN" | docker login ghcr.io -u <username> --password-stdin`,
      );
    }

    throw operationError(`could not pull ${ref}`, detail);
  }

  out.success(`pulled ${ref}`);

  return 0;
}
