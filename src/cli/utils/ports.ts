import * as net from 'node:net';
import { probeHost } from './health';

/**
 * Is anything already listening?
 *
 * Reset counts as free: a socket in TIME_WAIT still refuses a connection, and the
 * bind will succeed. This is a courtesy check — Docker reports the real conflict,
 * and its message is the one the user ends up reading.
 */
export function isPortFree(
  host: string,
  port: number,
  timeoutMs = 400,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: probeHost(host), port });

    const finish = (free: boolean): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(free);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(false));
    socket.once('timeout', () => finish(true));
    socket.once('error', (error: NodeJS.ErrnoException) => {
      finish(error.code === 'ECONNREFUSED' || error.code === 'EADDRNOTAVAIL');
    });
  });
}
