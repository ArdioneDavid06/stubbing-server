import { spawn } from 'node:child_process';
import { operationError } from '../errors';

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ExecOptions {
  /** Wire the child straight to this terminal, for `logs --follow`. */
  stream?: boolean;
}

/** The seam tests use: every Docker call goes through one function. */
export type ExecFn = (
  args: readonly string[],
  options?: ExecOptions,
) => Promise<CommandResult>;

/**
 * Run the Docker CLI with an argument array and no shell.
 *
 * `shell: false` plus an array is the whole safety story: a container name or a mount
 * path is a value, never a fragment of a command line, so `; rm -rf /` in a config
 * file is a string Docker receives and rejects — not something a shell interprets.
 */
export function spawnDocker(bin = 'docker'): ExecFn {
  return (args, options) =>
    new Promise((resolve, reject) => {
      const child = spawn(bin, [...args], {
        shell: false,
        stdio: options?.stream ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        stdout += chunk;
      });
      child.stderr?.on('data', (chunk: string) => {
        stderr += chunk;
      });

      child.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') {
          reject(
            operationError(
              'the docker command was not found',
              'Install Docker Desktop or the Docker Engine, then run this again.',
            ),
          );
          return;
        }

        reject(error);
      });

      child.on('close', (code) => {
        resolve({
          code: code ?? 1,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
        });
      });
    });
}

export interface ContainerState {
  id: string;
  name: string;
  image: string;
  status: string;
  health?: string;
  labels: Record<string, string>;
  /** Host port published for the container port, when Docker reports one. */
  hostPort?: string;
}

/** A container this CLI created, as opposed to anything else on the machine. */
export interface ManagedContainer extends ContainerState {
  /** The project label, or the container name when an older container has none. */
  project: string;
}

const MANAGED_LABEL = 'com.rmc.stubbing.managed';
const PROJECT_LABEL = 'com.rmc.stubbing.project';
const VERSION_LABEL = 'com.rmc.stubbing.version';

export class DockerClient {
  constructor(readonly exec: ExecFn = spawnDocker()) {}

  /** The daemon answers, not just the binary existing. */
  async daemonStatus(): Promise<{ ok: boolean; detail: string }> {
    const result = await this.exec([
      'version',
      '--format',
      '{{.Server.Version}}',
    ]);

    if (result.code === 0) {
      return { ok: true, detail: result.stdout.split('\n')[0] ?? '' };
    }

    const detail = `${result.stderr}\n${result.stdout}`.toLowerCase();

    if (
      detail.includes('cannot connect') ||
      detail.includes('is the docker daemon running')
    ) {
      return {
        ok: false,
        detail: 'the Docker daemon is not running (the CLI is installed)',
      };
    }

    return {
      ok: false,
      detail: result.stderr || result.stdout || 'docker version failed',
    };
  }

  async inspect(name: string): Promise<ContainerState | undefined> {
    const result = await this.exec(['inspect', name]);

    if (result.code !== 0) {
      return undefined;
    }

    const parsed = safeJson(result.stdout);

    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined;
    }

    return toContainerState(parsed[0] as Record<string, unknown>);
  }

  async imageExists(ref: string): Promise<boolean> {
    const result = await this.exec(['image', 'inspect', ref]);

    return result.code === 0;
  }

  async imageVersionLabel(ref: string): Promise<string | undefined> {
    const result = await this.exec([
      'image',
      'inspect',
      '--format',
      '{{index .Config.Labels "org.opencontainers.image.version"}}',
      ref,
    ]);

    const label = result.stdout.trim();

    return result.code === 0 && label.length > 0 && label !== '<no value>'
      ? label
      : undefined;
  }

  async pull(ref: string): Promise<CommandResult> {
    return this.exec(['pull', ref]);
  }

  async run(args: readonly string[]): Promise<CommandResult> {
    return this.exec(['run', ...args]);
  }

  async startContainer(name: string): Promise<CommandResult> {
    return this.exec(['start', name]);
  }

  async stopContainer(name: string): Promise<CommandResult> {
    return this.exec(['stop', name]);
  }

  async removeContainer(name: string): Promise<CommandResult> {
    return this.exec(['rm', '-f', name]);
  }

  async logs(
    name: string,
    options: { follow?: boolean; tail?: number; stream?: boolean } = {},
  ): Promise<CommandResult> {
    const args = ['logs'];

    if (options.follow) {
      args.push('--follow');
    }

    if (options.tail !== undefined) {
      args.push('--tail', String(options.tail));
    }

    args.push(name);

    return this.exec(args, { stream: options.stream });
  }

  /** Every container this CLI created, whatever project it belongs to. */
  async managedContainers(): Promise<ManagedContainer[]> {
    const result = await this.exec([
      'ps',
      '--all',
      '--filter',
      `label=${MANAGED_LABEL}=true`,
      '--format',
      '{{json .}}',
    ]);

    if (result.code !== 0) {
      throw operationError(
        'could not list containers',
        result.stderr || 'Is the Docker daemon running?',
      );
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => toManagedContainer(safeJson(line)))
      .filter(
        (container): container is ManagedContainer => container !== undefined,
      );
  }

  /** The labels a new container carries, so it is only ever managed by this tool. */
  static labels(project: string, version: string): Record<string, string> {
    return {
      [MANAGED_LABEL]: 'true',
      [PROJECT_LABEL]: project,
      [VERSION_LABEL]: version,
    };
  }
}

function toContainerState(raw: unknown): ContainerState | undefined {
  const record = asRecord(raw);

  if (!record) {
    return undefined;
  }

  const state = asRecord(record.State) ?? {};
  const config = asRecord(record.Config) ?? {};
  const network = asRecord(record.NetworkSettings) ?? {};
  const ports = asRecord(network.Ports) ?? {};

  const firstPort = Object.values(ports)
    .flatMap((value) => (Array.isArray(value) ? value : []))
    .map((entry) => asRecord(entry))
    .find((entry) => typeof entry?.HostPort === 'string');

  return {
    id: String(record.Id ?? ''),
    name: String(record.Name ?? '').replace(/^\//, ''),
    image: String(config.Image ?? ''),
    status: String(state.Status ?? 'unknown'),
    health: asRecord(state.Health)?.Status as string | undefined,
    labels: (asRecord(config.Labels) ?? {}) as Record<string, string>,
    hostPort: firstPort?.HostPort as string | undefined,
  };
}

function toManagedContainer(raw: unknown): ManagedContainer | undefined {
  const record = asRecord(raw);

  if (!record) {
    return undefined;
  }

  const labels = parseLabels(record.Labels);

  return {
    id: String(record.ID ?? ''),
    name: String(record.Names ?? ''),
    image: String(record.Image ?? ''),
    status: String(record.State ?? 'unknown'),
    health: String(record.Status ?? ''),
    labels,
    hostPort: parsePublishedPort(record.Ports),
    project: labels[PROJECT_LABEL] ?? String(record.Names ?? ''),
  };
}

/** `docker ps --format '{{json .}}'` renders labels as "a=b,c=d". */
function parseLabels(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || raw.length === 0) {
    return {};
  }

  return Object.fromEntries(
    raw
      .split(',')
      .map((pair) => pair.split('='))
      .filter((parts) => parts.length === 2)
      .map(([key, value]) => [key, value]),
  );
}

function parsePublishedPort(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const match = /:(\d+)->/.exec(raw);

  return match?.[1];
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
