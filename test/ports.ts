// A port for a test's editor: the system picks one nobody uses, instead of a random guess, which now and then
// hit a port in use (the editor then can't start, and the test waits until it times out).

import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';

export async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((ok, fail) => server.once('error', fail).listen(0, '127.0.0.1', ok));
  const { port } = server.address() as AddressInfo;
  await new Promise((ok) => server.close(ok));
  return port;
}
