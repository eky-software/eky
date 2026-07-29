import { createServer } from 'node:net';

type E2eNetServer = ReturnType<typeof createServer> & {
  on(event: 'error', listener: (error: Error) => void): E2eNetServer;
};

export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer() as E2eNetServer;

  return await new Promise<number>((resolvePort, rejectPort) => {
    server.on('error', rejectPort);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        rejectPort(new Error('Loopback port could not be reserved.'));
        return;
      }

      server.close((error) => {
        if (error !== undefined) {
          rejectPort(error);
          return;
        }
        resolvePort(address.port);
      });
    });
  });
}
