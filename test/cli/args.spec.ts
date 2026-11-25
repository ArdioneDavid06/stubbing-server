import { parseArgs } from '../../src/cli/args';
import { CliError } from '../../src/cli/errors';

function codes(action: () => unknown): number {
  try {
    action();
  } catch (error) {
    return (error as CliError).exitCode;
  }

  throw new Error('expected the parse to fail');
}

describe('parseArgs', () => {
  it('reads a command and no options', () => {
    expect(parseArgs(['start'])).toEqual({
      command: 'start',
      options: {},
    });
  });

  it('reads a valued option as the next argument', () => {
    expect(parseArgs(['start', '--port', '4011']).options.port).toBe('4011');
  });

  it('reads a valued option written with an equals sign', () => {
    expect(parseArgs(['start', '--port=4011']).options.port).toBe('4011');
  });

  it('reads switches, including --no-pull', () => {
    expect(parseArgs(['start', '--no-pull']).options.noPull).toBe(true);
  });

  it('maps the short aliases', () => {
    expect(parseArgs(['start', '-p', '4011']).options.port).toBe('4011');
    expect(parseArgs(['logs', '-f']).options.follow).toBe(true);
    expect(parseArgs(['version']).command).toBe('version');
  });

  it('renames kebab-case options to camelCase', () => {
    expect(parseArgs(['start', '--image-tag', '2.0.0']).options.imageTag).toBe(
      '2.0.0',
    );
  });

  it('accepts --help with no command', () => {
    expect(parseArgs(['--help']).options.help).toBe(true);
    expect(parseArgs(['--help']).command).toBeUndefined();
  });

  it('rejects an unknown option instead of ignoring it', () => {
    expect(codes(() => parseArgs(['start', '--prot', '4010']))).toBe(2);
  });

  it('rejects a valued option with no value', () => {
    expect(codes(() => parseArgs(['start', '--port']))).toBe(2);
    expect(codes(() => parseArgs(['start', '--port', '--host']))).toBe(2);
  });

  it('rejects a switch given a value', () => {
    expect(codes(() => parseArgs(['start', '--no-pull=yes']))).toBe(2);
  });

  it('rejects an option twice, because last-wins hides a mistake', () => {
    expect(
      codes(() => parseArgs(['start', '--port', '1', '--port', '2'])),
    ).toBe(2);
  });

  it('rejects an unknown command', () => {
    expect(codes(() => parseArgs(['stpo']))).toBe(2);
  });

  it('rejects two commands', () => {
    expect(codes(() => parseArgs(['start', 'stop']))).toBe(2);
  });

  it('rejects an option that belongs to another command', () => {
    // `logs --port` would be accepted and do nothing, which is worse than a refusal.
    expect(codes(() => parseArgs(['logs', '--port', '4010']))).toBe(2);
    expect(codes(() => parseArgs(['start', '--tail', '10']))).toBe(2);
  });

  it('stops parsing options after --', () => {
    expect(codes(() => parseArgs(['start', '--', 'extra']))).toBe(2);
  });
});
