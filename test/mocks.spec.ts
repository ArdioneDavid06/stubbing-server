import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { describeRuleError, seedMocks } from '../src/app/mocks';
import { Rules } from '../src/core/dynamic/rules.service';
import { Failures } from '../src/core/failures/failures.service';

describe('seeding rules from a directory', () => {
  const dirs: string[] = [];

  function dir(): string {
    const created = fs.mkdtempSync(path.join(os.tmpdir(), 'stubbing-mocks-'));
    dirs.push(created);
    return created;
  }

  function write(target: string, name: string, body: unknown): void {
    fs.writeFileSync(
      path.join(target, name),
      typeof body === 'string' ? body : JSON.stringify(body, null, 2),
    );
  }

  afterEach(() => {
    for (const created of dirs.splice(0)) {
      fs.rmSync(created, { recursive: true, force: true });
    }
  });

  it('installs every rule in every json file', () => {
    const mocks = dir();
    const rules = new Rules();

    write(mocks, 'customers.json', [
      { method: 'GET', path: '/v2/customers/:id', body: { id: 'C-1' } },
      { method: 'GET', path: '/v2/customers/missing', status: 404, times: 1 },
    ]);
    write(mocks, 'orders.json', {
      method: 'POST',
      path: '/v2/orders',
      status: 201,
    });

    const result = seedMocks({ dir: mocks, rules, failures: new Failures() });

    expect(result).toMatchObject({ rules: 3, failures: 0 });
    expect(result.files).toEqual(['customers.json', 'orders.json']);
    expect(rules.list()).toHaveLength(3);
  });

  it('lists the files it read, so a typo in a directory is visible', () => {
    const mocks = dir();
    const lines: string[] = [];

    write(mocks, 'a.json', [{ path: '/a' }]);
    write(mocks, 'README.md', 'not json, ignored');

    seedMocks({
      dir: mocks,
      rules: new Rules(),
      failures: new Failures(),
      log: (line) => lines.push(line),
    });

    expect(lines).toEqual(['  a.json: 1 entry']);
  });

  it('installs failures from failures.json', () => {
    const mocks = dir();
    const failures = new Failures();

    write(mocks, 'failures.json', [{ key: 'C-1', status: 409 }]);

    const result = seedMocks({ dir: mocks, rules: new Rules(), failures });

    expect(result).toMatchObject({ rules: 0, failures: 1 });
    expect(failures.take('C-1')?.status).toBe(409);
  });

  it('validates through the same path a POST would, and names the entry', () => {
    const mocks = dir();

    write(mocks, 'bad.json', [{ path: '/ok' }, { path: 'not-absolute' }]);

    expect(() =>
      seedMocks({ dir: mocks, rules: new Rules(), failures: new Failures() }),
    ).toThrow(/bad\.json\[1\].*path/);
  });

  it('rejects a file that is not JSON', () => {
    const mocks = dir();

    write(mocks, 'broken.json', '{ nope');

    expect(() =>
      seedMocks({ dir: mocks, rules: new Rules(), failures: new Failures() }),
    ).toThrow(/broken\.json: not valid JSON/);
  });

  it('rejects a directory that does not exist', () => {
    expect(() =>
      seedMocks({
        dir: path.join(os.tmpdir(), 'stubbing-does-not-exist-xyz'),
        rules: new Rules(),
        failures: new Failures(),
      }),
    ).toThrow(/does not exist/);
  });

  it('seeds nothing from an empty directory rather than failing', () => {
    const result = seedMocks({
      dir: dir(),
      rules: new Rules(),
      failures: new Failures(),
    });

    expect(result).toEqual({ rules: 0, failures: 0, files: [] });
  });
});

describe('describeRuleError', () => {
  it('turns a 400 body into one line', () => {
    const { BadRequestException } = require('@nestjs/common');

    const message = describeRuleError(
      new BadRequestException({ message: 'a; b', errors: ['a', 'b'] }),
    );

    expect(message).toBe('a; b');
  });

  it('falls back to the message of anything else', () => {
    expect(describeRuleError(new Error('boom'))).toBe('boom');
  });
});
