/** Where the CLI writes. Injected so tests can read what a command told the user. */
export interface Out {
  info(message: string): void;
  success(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export const consoleOut: Out = {
  info: (message) => process.stdout.write(`${message}\n`),
  success: (message) => process.stdout.write(`${message}\n`),
  warn: (message) => process.stderr.write(`${message}\n`),
  error: (message) => process.stderr.write(`${message}\n`),
};

/** A key/value block: aligned, and readable when a human is debugging at 2am. */
export function fieldBlock(
  fields: Array<[string, string | undefined]>,
): string {
  const width = Math.max(...fields.map(([label]) => label.length));

  return fields
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `  ${label.padEnd(width)}  ${value}`)
    .join('\n');
}
