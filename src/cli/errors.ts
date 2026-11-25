/**
 * How the CLI fails.
 *
 * Exit codes are part of the interface, because a CI step branches on them:
 *
 *   0  the command did what it said
 *   1  it could not (Docker down, image missing, health never came up)
 *   2  the caller asked for something impossible (bad flag, bad config file)
 */
export class CliError extends Error {
  constructor(
    message: string,
    readonly exitCode: number = 1,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** The caller's mistake, not the environment's. */
export function usageError(message: string, hint?: string): CliError {
  return new CliError(message, 2, hint);
}

/** The environment's problem: Docker, the registry, a port, a container. */
export function operationError(message: string, hint?: string): CliError {
  return new CliError(message, 1, hint);
}
