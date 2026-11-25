import { DockerClient } from '../../src/cli/docker/docker-client';
import type { CommandResult, ExecFn } from '../../src/cli/docker/docker-client';
import type { Out } from '../../src/cli/utils/output';

export interface FakeDockerOptions {
  /** `false` simulates a CLI with no daemon behind it. */
  daemon?: boolean;
  /** The JSON `docker inspect` returns, or null for "no such container". */
  container?: Record<string, unknown> | null;
  imagePresent?: boolean;
  pullError?: string;
  runError?: string;
  logs?: string;
}

export interface FakeDocker {
  docker: DockerClient;
  calls: string[][];
  argsOf: (name: string) => string[] | undefined;
}

/**
 * A Docker that records what it was asked to do.
 *
 * The point is the argument array: a test can assert that a rule file is mounted
 * read-only, or that a container name reaches Docker as one value and not as part of
 * a command line.
 */
export function fakeDocker(options: FakeDockerOptions = {}): FakeDocker {
  const calls: string[][] = [];
  const daemon = options.daemon ?? true;

  const exec: ExecFn = async (args): Promise<CommandResult> => {
    const list = [...args];
    calls.push(list);

    const [group, sub] = list;

    if (group === 'version') {
      return daemon
        ? { code: 0, stdout: '27.0.0', stderr: '' }
        : {
            code: 1,
            stdout: '',
            stderr:
              'Cannot connect to the Docker daemon at unix:///var/run/docker.sock',
          };
    }

    if (group === 'inspect') {
      return options.container
        ? { code: 0, stdout: JSON.stringify([options.container]), stderr: '' }
        : {
            code: 1,
            stdout: '',
            stderr: `Error: No such object: ${list[1]}`,
          };
    }

    if (group === 'image') {
      return (options.imagePresent ?? true)
        ? { code: 0, stdout: '[]', stderr: '' }
        : { code: 1, stdout: '', stderr: 'No such image' };
    }

    if (group === 'pull') {
      return options.pullError
        ? { code: 1, stdout: '', stderr: options.pullError }
        : { code: 0, stdout: 'pulled', stderr: '' };
    }

    if (group === 'run') {
      return options.runError
        ? { code: 1, stdout: '', stderr: options.runError }
        : { code: 0, stdout: 'container-id', stderr: '' };
    }

    if (group === 'logs') {
      return { code: 0, stdout: options.logs ?? '', stderr: '' };
    }

    if (sub === undefined) {
      return { code: 0, stdout: '', stderr: '' };
    }

    return { code: 0, stdout: '', stderr: '' };
  };

  return {
    docker: new DockerClient(exec),
    calls,
    argsOf: (name) => calls.find((call) => call[0] === name),
  };
}

export interface CapturedOut extends Out {
  lines: string[];
}

export function captureOut(): CapturedOut {
  const lines: string[] = [];

  return {
    lines,
    info: (message) => lines.push(message),
    success: (message) => lines.push(message),
    warn: (message) => lines.push(message),
    error: (message) => lines.push(message),
  };
}

/** A container document in the shape `docker inspect` returns. */
export function containerDocument(overrides: {
  image?: string;
  status?: string;
  labels?: Record<string, string>;
  hostPort?: string | null;
}): Record<string, unknown> {
  const labels = overrides.labels ?? {
    'com.rmc.stubbing.managed': 'true',
    'com.rmc.stubbing.project': 'stubbing-server',
  };

  return {
    Id: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    Name: '/stubbing-server',
    Config: {
      Image: overrides.image ?? 'ghcr.io/rmc/stubbing-server:1.0.0',
      Labels: labels,
    },
    State: { Status: overrides.status ?? 'running' },
    NetworkSettings: {
      Ports:
        overrides.hostPort === null
          ? {}
          : {
              '4010/tcp': [
                { HostIp: '127.0.0.1', HostPort: overrides.hostPort ?? '4010' },
              ],
            },
    },
  };
}
