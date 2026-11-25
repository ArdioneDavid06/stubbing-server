import { planFor, runArgs } from '../../src/cli/docker/container-manager';
import type { StubConfig } from '../../src/cli/config/defaults';
import { defaultConfig } from '../../src/cli/config/defaults';
import { DockerClient } from '../../src/cli/docker/docker-client';
import { containerDocument, fakeDocker } from './fakes';

function config(overrides: Partial<StubConfig> = {}): StubConfig {
  return { ...defaultConfig(), ...overrides };
}

describe('docker run arguments', () => {
  it('builds a fixed, reviewable array', () => {
    expect(runArgs(config(), { version: '1.0.0' })).toEqual([
      '-d',
      '--name',
      'stubbing-server',
      '--label',
      'com.rmc.stubbing.managed=true',
      '--label',
      'com.rmc.stubbing.project=stubbing-server',
      '--label',
      'com.rmc.stubbing.version=1.0.0',
      '-p',
      '127.0.0.1:4010:4010',
      '-e',
      'STUB_PORT=4010',
      'ghcr.io/rmc/stubbing-server:1.0.0',
    ]);
  });

  it('mounts the mocks directory read-only and tells the server where it is', () => {
    const args = runArgs(
      config({ mocksPath: 'C:/repo/stubs', containerPort: 4010 }),
      { version: '1.0.0' },
    );

    expect(args).toContain('C:/repo/stubs:/stubs:ro');
    expect(args).toContain('STUB_MOCKS_DIR=/stubs');
  });

  it('passes environment sorted, so the same config is the same command', () => {
    const args = runArgs(config({ environment: { ZEBRA: 'z', ALPHA: 'a' } }), {
      version: '1.0.0',
    });
    const environment = args.filter((arg, index) => args[index - 1] === '-e');

    expect(environment).toEqual(['ALPHA=a', 'STUB_PORT=4010', 'ZEBRA=z']);
  });

  it('refuses to let environment.STUB_PORT disagree with containerPort', () => {
    expect(() =>
      runArgs(config({ environment: { STUB_PORT: '9999' } }), {
        version: '1.0.0',
      }),
    ).toThrow(/containerPort/);
  });

  it('keeps a name with shell characters as one argument, never a command line', () => {
    const args = runArgs(config({ containerName: 'a; rm -rf /' }), {
      version: '1.0.0',
    });

    expect(args[2]).toBe('a; rm -rf /');
    expect(args).toHaveLength(14);
  });
});

describe('planFor', () => {
  it('creates when nothing exists', () => {
    expect(planFor(undefined, config())).toEqual({ action: 'create' });
  });

  it('starts a stopped container', () => {
    expect(
      planFor(
        {
          id: 'x',
          name: 'stubbing-server',
          image: 'ghcr.io/rmc/stubbing-server:1.0.0',
          status: 'exited',
          labels: {},
        },
        config(),
      ),
    ).toEqual({ action: 'start' });
  });

  it('reuses a running container with the same image and port', () => {
    expect(
      planFor(
        {
          id: 'x',
          name: 'stubbing-server',
          image: 'ghcr.io/rmc/stubbing-server:1.0.0',
          status: 'running',
          hostPort: '4010',
          labels: {},
        },
        config(),
      ),
    ).toEqual({ action: 'reuse' });
  });

  it('refuses to replace a container built from another image', () => {
    expect(
      planFor(
        {
          id: 'x',
          name: 'stubbing-server',
          image: 'ghcr.io/rmc/stubbing-server:0.9.0',
          status: 'running',
          hostPort: '4010',
          labels: {},
        },
        config(),
      ).action,
    ).toBe('conflict');
  });

  it('refuses a container publishing another port', () => {
    const plan = planFor(
      {
        id: 'x',
        name: 'stubbing-server',
        image: 'ghcr.io/rmc/stubbing-server:1.0.0',
        status: 'running',
        hostPort: '4444',
        labels: {},
      },
      config(),
    );

    expect(plan.action).toBe('conflict');
    expect(plan.action === 'conflict' ? plan.reason : '').toContain('4444');
  });
});

describe('DockerClient', () => {
  it('reports a daemon that answers', async () => {
    expect(await fakeDocker().docker.daemonStatus()).toMatchObject({
      ok: true,
    });
  });

  it('turns a refused connection into something a person can act on', async () => {
    const status = await fakeDocker({ daemon: false }).docker.daemonStatus();

    expect(status.ok).toBe(false);
    expect(status.detail).toContain('daemon is not running');
  });

  it('parses the container it was asked about', async () => {
    const { docker } = fakeDocker({ container: containerDocument({}) });
    const state = await docker.inspect('stubbing-server');

    expect(state).toMatchObject({
      status: 'running',
      image: 'ghcr.io/rmc/stubbing-server:1.0.0',
      hostPort: '4010',
    });
  });

  it('returns undefined for a container that is not there', async () => {
    const { docker } = fakeDocker({ container: null });

    expect(await docker.inspect('stubbing-server')).toBeUndefined();
  });

  it('asks for logs with the tail and follow it was given', async () => {
    const fake = fakeDocker({ container: containerDocument({}) });

    await fake.docker.logs('stubbing-server', { follow: true, tail: 5 });

    expect(fake.argsOf('logs')).toEqual([
      'logs',
      '--follow',
      '--tail',
      '5',
      'stubbing-server',
    ]);
  });

  it('lists only the containers this tool manages', async () => {
    const client = new DockerClient(async () => ({
      code: 0,
      stdout: [
        JSON.stringify({
          ID: 'abc',
          Names: 'orders-stub',
          Image: 'ghcr.io/rmc/stubbing-server:1.0.0',
          State: 'running',
          Status: 'Up 2 minutes',
          Labels:
            'com.rmc.stubbing.managed=true,com.rmc.stubbing.project=orders',
          Ports: '127.0.0.1:4010->4010/tcp',
        }),
      ].join('\n'),
      stderr: '',
    }));

    const containers = await client.managedContainers();

    expect(containers).toHaveLength(1);
    expect(containers[0]).toMatchObject({
      project: 'orders',
      hostPort: '4010',
    });
  });
});
