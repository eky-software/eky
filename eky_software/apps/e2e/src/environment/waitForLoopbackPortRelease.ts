import { createServer } from 'node:net';

type E2eNetServer = ReturnType<typeof createServer> & {
  on(
    event: 'error',
    listener: (error: NodeJS.ErrnoException) => void,
  ): E2eNetServer;
};

export async function waitForLoopbackPortRelease(
  port: number,
  timeoutMilliseconds = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMilliseconds;

  while (Date.now() < deadline) {
    if (await canListen(port)) {
      return;
    }
    await delay(50);
  }

  throw new Error(`Managed E2E process did not release loopback port ${port}.`);
}

async function canListen(port: number): Promise<boolean> {
  const server = createServer() as E2eNetServer;

  return await new Promise<boolean>((resolveAvailability, rejectAvailability) => {
    server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        resolveAvailability(false);
        return;
      }
      rejectAvailability(error);
    });
    server.listen(port, '127.0.0.1', () => {
      server.close((error) => {
        if (error !== undefined) {
          rejectAvailability(error);
          return;
        }
        resolveAvailability(true);
      });
    });
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => {
    setTimeout(resolveDelay, milliseconds);
  });
}
