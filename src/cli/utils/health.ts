import * as http from 'node:http';

export interface ProbeResult {
  ok: boolean;
  detail: string;
}

/** Probing `0.0.0.0` is meaningless: it is a bind address, not a destination. */
export function probeHost(host: string): string {
  return host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
}

/**
 * One health probe. A refusal is not an error worth throwing: while a container is
 * starting, `ECONNREFUSED` is the expected answer for the first second or two.
 */
export function probeHealth(
  host: string,
  port: number,
  path: string,
  timeoutMs = 2_000,
): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const request = http.get(
      { host: probeHost(host), port, path, timeout: timeoutMs },
      (response) => {
        response.resume();
        resolve({
          ok: response.statusCode !== undefined && response.statusCode < 400,
          detail: `HTTP ${response.statusCode ?? 0}`,
        });
      },
    );

    request.on('timeout', () => {
      request.destroy();
      resolve({ ok: false, detail: `no answer in ${timeoutMs}ms` });
    });

    request.on('error', (error: NodeJS.ErrnoException) => {
      resolve({ ok: false, detail: error.code ?? error.message });
    });
  });
}

export interface WaitOptions {
  host: string;
  port: number;
  path: string;
  timeoutMs: number;
  intervalMs: number;
  probe?: typeof probeHealth;
  now?: () => number;
}

export interface WaitResult {
  ok: boolean;
  attempts: number;
  waitedMs: number;
  lastDetail: string;
}

/**
 * Poll until the server answers, then stop.
 *
 * A timeout is a failure the caller has to handle, not a warning: a test suite that
 * starts against a stub that is not ready fails for a reason that has nothing to do
 * with the code under test.
 */
export async function waitForHealth(options: WaitOptions): Promise<WaitResult> {
  const probe = options.probe ?? probeHealth;
  const now = options.now ?? Date.now;
  const started = now();
  let attempts = 0;
  let lastDetail = 'not probed';

  for (;;) {
    attempts += 1;

    const result = await probe(options.host, options.port, options.path);
    lastDetail = result.detail;

    if (result.ok) {
      return { ok: true, attempts, waitedMs: now() - started, lastDetail };
    }

    if (now() - started + options.intervalMs > options.timeoutMs) {
      return {
        ok: false,
        attempts,
        waitedMs: now() - started,
        lastDetail,
      };
    }

    await new Promise((resolve) => setTimeout(resolve, options.intervalMs));
  }
}
