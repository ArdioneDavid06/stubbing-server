import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadConfig } from '../../src/cli/config/loader';
import { CliError } from '../../src/cli/errors';
import {
  DEFAULT_IMAGE,
  DEFAULT_IMAGE_TAG,
  defaultConfig,
} from '../../src/cli/config/defaults';

function workspace(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'stubbing-cli-'));
}

function write(dir: string, name: string, body: unknown): void {
  fs.writeFileSync(
    path.join(dir, name),
    typeof body === 'string' ? body : JSON.stringify(body, null, 2),
  );
}

function exitCodeOf(action: () => unknown): number {
  try {
    action();
  } catch (error) {
    return (error as CliError).exitCode;
  }

  throw new Error('expected the load to fail');
}

describe('configuration', () => {
  const dirs: string[] = [];

  function dir(): string {
    const created = workspace();
    dirs.push(created);
    return created;
  }

  afterEach(() => {
    for (const created of dirs.splice(0)) {
      fs.rmSync(created, { recursive: true, force: true });
    }
  });

  it('starts from safe defaults when there is no config file', () => {
    const { config, configPath } = loadConfig({}, dir());

    expect(configPath).toBeUndefined();
    expect(config).toMatchObject({
      image: DEFAULT_IMAGE,
      imageTag: DEFAULT_IMAGE_TAG,
      containerName: 'stubbing-server',
      host: '127.0.0.1',
      port: 4010,
      containerPort: 4010,
      pull: 'missing',
    });
    expect(config.healthcheck).toMatchObject({
      path: '/health',
      timeoutMs: 60_000,
      intervalMs: 500,
    });
  });

  it('reads stubbing.config.json from the working directory', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', {
      containerName: 'orders-stub',
      port: 4020,
    });

    const { config, configPath } = loadConfig({}, cwd);

    expect(config.containerName).toBe('orders-stub');
    expect(config.port).toBe(4020);
    expect(configPath).toBe(path.join(cwd, 'stubbing.config.json'));
  });

  it('lets a flag win over the file, and the file win over a default', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', { port: 4020, imageTag: '2.0.0' });

    const { config } = loadConfig({ port: '4030' }, cwd);

    expect(config.port).toBe(4030);
    expect(config.imageTag).toBe('2.0.0');
    expect(config.host).toBe('127.0.0.1');
  });

  it('reads a config file given explicitly, from another directory', () => {
    const cwd = dir();
    const other = dir();
    write(other, 'custom.json', { containerName: 'explicit' });

    const { config } = loadConfig(
      { config: path.relative(cwd, path.join(other, 'custom.json')) },
      cwd,
    );

    expect(config.containerName).toBe('explicit');
  });

  it('fails when an explicit config file is missing', () => {
    expect(exitCodeOf(() => loadConfig({ config: './nope.json' }, dir()))).toBe(
      2,
    );
  });

  it('rejects unknown keys, so a typo is not silently ignored', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', { prot: 4010 });

    expect(exitCodeOf(() => loadConfig({}, cwd))).toBe(2);
  });

  it('rejects invalid JSON with the file name', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', '{ nope');

    let message = '';

    try {
      loadConfig({}, cwd);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toContain('is not valid JSON');
    expect(message).toContain('stubbing.config.json');
  });

  it('refuses "latest", because two runs of a moving tag are two different runs', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', { imageTag: 'latest' });

    expect(exitCodeOf(() => loadConfig({}, cwd))).toBe(2);
  });

  it('resolves mocksPath against the config file, not the working directory', () => {
    const cwd = dir();
    fs.mkdirSync(path.join(cwd, 'rules'));
    write(cwd, 'stubbing.config.json', { mocksPath: './rules' });

    const fromRoot = loadConfig({}, cwd).config;
    const fromSubdirectory = loadConfig(
      { config: path.join(cwd, 'stubbing.config.json') },
      path.dirname(cwd),
    ).config;

    expect(fromRoot.mocksPath).toBe(path.join(cwd, 'rules'));
    expect(fromSubdirectory.mocksPath).toBe(path.join(cwd, 'rules'));
  });

  it('rejects a mocksPath that does not exist', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', { mocksPath: './missing' });

    expect(exitCodeOf(() => loadConfig({}, cwd))).toBe(2);
  });

  it('refuses environment.STUB_PORT, which would fight containerPort', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', {
      environment: { STUB_PORT: '4010' },
    });

    expect(exitCodeOf(() => loadConfig({}, cwd))).toBe(2);
  });

  it('rejects a non-string environment value', () => {
    const cwd = dir();
    write(cwd, 'stubbing.config.json', { environment: { RETRIES: 3 } });

    expect(exitCodeOf(() => loadConfig({}, cwd))).toBe(2);
  });

  it('rejects an invalid container name, before it reaches docker', () => {
    expect(exitCodeOf(() => loadConfig({ name: 'a; rm -rf /' }, dir()))).toBe(
      2,
    );
  });

  it('rejects --pull together with --no-pull', () => {
    expect(
      exitCodeOf(() => loadConfig({ pull: true, noPull: true }, dir())),
    ).toBe(2);
  });

  it('applies --pull and --no-pull to the pull policy', () => {
    const cwd = dir();

    expect(loadConfig({ pull: true }, cwd).config.pull).toBe('always');
    expect(loadConfig({ noPull: true }, cwd).config.pull).toBe('never');
  });

  it('applies --timeout to the healthcheck', () => {
    expect(
      loadConfig({ timeout: '5000' }, dir()).config.healthcheck.timeoutMs,
    ).toBe(5000);
    expect(exitCodeOf(() => loadConfig({ timeout: 'soon' }, dir()))).toBe(2);
  });

  it('rejects a port that is not a port', () => {
    expect(exitCodeOf(() => loadConfig({ port: '70000' }, dir()))).toBe(2);
    expect(exitCodeOf(() => loadConfig({ port: 'abc' }, dir()))).toBe(2);
  });

  it('keeps the documented default image derived from the package scope', () => {
    expect(defaultConfig().image).toBe(DEFAULT_IMAGE);
    expect(DEFAULT_IMAGE.startsWith('ghcr.io/')).toBe(true);
  });
});
