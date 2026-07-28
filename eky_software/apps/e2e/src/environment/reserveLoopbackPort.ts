import { createServer } from 'node:net';

export async function reserveLoopbackPort(): Promise<number> {
  const server = createServer();

  return await new Promise<number>((resolvePort, rejectPort) => {
    server.once('error', rejectPort);
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
