import type { StubConfig } from './config/defaults';
import type { DockerClient } from './docker/docker-client';
import type { Out } from './utils/output';
import { isPortFree } from './utils/ports';
import { waitForHealth } from './utils/health';

/**
 * What every command gets. The two functions are injectable because a test of the
 * start flow should not need a real container to prove what it does when the port is
 * taken or the health probe never answers.
 */
export interface CommandContext {
  config: StubConfig;
  docker: DockerClient;
  out: Out;
  /** This CLI's version, and the label put on containers it creates. */
  version: string;
  health?: typeof waitForHealth;
  portFree?: typeof isPortFree;
}

export function healthOf(context: CommandContext): typeof waitForHealth {
  return context.health ?? waitForHealth;
}

export function portFreeOf(context: CommandContext): typeof isPortFree {
  return context.portFree ?? isPortFree;
}
