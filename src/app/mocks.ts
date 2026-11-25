import * as fs from 'node:fs';
import * as path from 'node:path';
import { HttpException } from '@nestjs/common';
import type { Rules } from '../core/dynamic/rules.service';
import type { Failures } from '../core/failures/failures.service';

/**
 * Rules from files, for a run that must be reproducible without an HTTP call.
 *
 * The container mounts a directory read-only (the CLI does this) and this reads it at
 * startup. Every entry goes through the same `Rules.add` a POST would use, so a file
 * cannot install a rule the API would refuse — and a bad file stops the container
 * before the port opens, rather than leaving a stub that silently answers nothing.
 *
 * Layout:
 *
 *   <dir>/partner.json     one rule, or an array of rules
 *   <dir>/failures.json    an array of failures
 *
 * Other files are ignored, so a README can live in the same directory.
 */

export interface SeedOptions {
  dir: string;
  rules: Rules;
  failures: Failures;
  /** Where to say what was installed. Injectable so a test can read it. */
  log?: (message: string) => void;
}

export interface SeedResult {
  rules: number;
  failures: number;
  files: string[];
}

export function seedMocks(options: SeedOptions): SeedResult {
  const log = options.log ?? (() => undefined);

  if (!fs.existsSync(options.dir)) {
    throw new Error(`mocks directory does not exist: ${options.dir}`);
  }

  const files = fs
    .readdirSync(options.dir)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort();

  const result: SeedResult = { rules: 0, failures: 0, files: [] };

  for (const file of files) {
    const full = path.join(options.dir, file);
    const document = readJson(full, file);
    const entries = Array.isArray(document) ? document : [document];

    entries.forEach((entry, index) => {
      try {
        if (file.toLowerCase() === 'failures.json') {
          options.failures.add(entry);
          result.failures += 1;
          return;
        }

        options.rules.add(entry);
        result.rules += 1;
      } catch (error) {
        throw new Error(`${file}[${index}]: ${describeRuleError(error)}`);
      }
    });

    result.files.push(file);
    log(
      `  ${file}: ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'}`,
    );
  }

  return result;
}

function readJson(full: string, file: string): unknown {
  let text: string;

  try {
    text = fs.readFileSync(full, 'utf8');
  } catch (error) {
    throw new Error(`${file}: could not read (${(error as Error).message})`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file}: not valid JSON (${(error as Error).message})`);
  }
}

/** The 400 a rule endpoint would return, as one line that names the entry. */
export function describeRuleError(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();

    if (typeof response === 'object' && response !== null) {
      const body = response as { message?: unknown; errors?: unknown };

      if (Array.isArray(body.errors)) {
        return body.errors.join('; ');
      }

      if (typeof body.message === 'string') {
        return body.message;
      }
    }

    return error.message;
  }

  return (error as Error).message;
}
