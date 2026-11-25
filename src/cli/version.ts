/**
 * The CLI's own version, read from package.json.
 *
 * From `dist/cli/version.js` and from `src/cli/version.ts` this resolves to the same
 * file, so the number printed by `--version` is the number that was published.
 */
export function cliVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: string };

    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}
