import {
  createServer as createNetServer,
  type Server as NetServer,
  type Socket,
} from 'node:net';
import {
  createServer as createTlsServer,
  type Server as TlsServer,
  type TlsOptions,
} from 'node:tls';

import { afterEach, describe, expect, it } from 'vitest';

import { connectImplicitTlsSmtp } from './smtpConnection.js';
import {
  smtpTestCertificatePem,
  smtpTestPrivateKeyPem,
} from '../../../testFixtures/smtpTestTlsFixture.js';

const servers: Array<NetServer | TlsServer> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map(closeServer));
});

describe('connectImplicitTlsSmtp local TLS integration', () => {
  it('accepts the trusted test certificate and correct hostname before SMTP data flows', async () => {
    const receivedChunks: Buffer[] = [];
    const { port } = await listenTlsServer({}, (socket) => {
      socket.on('data', (chunk) => {
        receivedChunks.push(Buffer.from(chunk));
        socket.write('250 smtp.example.test\r\n', 'ascii');
      });
      socket.write('220 smtp.example.test ready\r\n', 'ascii');
    });

    const connection = await connectToLocalServer(port);
    expect(receivedChunks).toEqual([]);
    await expect(connection.readReply(1_000, 'greeting')).resolves.toMatchObject({
      code: 220,
    });

    const command = connection.sendCommand('EHLO localhost', 1_000, 'ehlo');
    await waitFor(() => receivedChunks.length > 0);
    expect(Buffer.concat(receivedChunks).toString('ascii')).toBe(
      'EHLO localhost\r\n',
    );
    await expect(command).resolves.toMatchObject({ code: 250 });
    connection.close();
  });

  it('rejects a certificate for the wrong hostname', async () => {
    const { port } = await listenTlsServer();

    await expect(
      connectToLocalServer(port, { servername: 'wrong.example.test' }),
    ).rejects.toMatchObject({ code: 'SMTP_TLS_FAILED' });
  });

  it('rejects a certificate from an unknown CA', async () => {
    const { port } = await listenTlsServer();

    await expect(
      connectToLocalServer(port, { ca: undefined }),
    ).rejects.toMatchObject({ code: 'SMTP_TLS_FAILED' });
  });

  it('rejects a server that only supports TLS versions older than 1.2', async () => {
    const { port } = await listenTlsServer({ maxVersion: 'TLSv1.1' });

    await expect(connectToLocalServer(port)).rejects.toMatchObject({
      code: expect.stringMatching(/^SMTP_(TLS|CONNECTION)_FAILED$/),
    });
  });

  it('rejects an interrupted TLS handshake without sending SMTP commands', async () => {
    const receivedChunks: Buffer[] = [];
    const { port } = await listenNetServer((socket) => {
      socket.on('data', (chunk) => receivedChunks.push(Buffer.from(chunk)));
      socket.destroy();
    });

    await expect(connectToLocalServer(port)).rejects.toMatchObject({
      code: 'SMTP_CONNECTION_FAILED',
    });
    expect(receivedChunks.length).toBeLessThanOrEqual(1);
  });

  it('times out a stalled TLS handshake without sending SMTP application data', async () => {
    const receivedChunks: Buffer[] = [];
    const { port } = await listenNetServer((socket) => {
      socket.on('data', (chunk) => receivedChunks.push(Buffer.from(chunk)));
    });

    await expect(
      connectToLocalServer(port, { connectionTimeoutMilliseconds: 50 }),
    ).rejects.toMatchObject({ code: 'SMTP_TIMEOUT' });

    expect(receivedChunks.length).toBeLessThanOrEqual(1);
    expect(Buffer.concat(receivedChunks).includes(Buffer.from('EHLO'))).toBe(false);
  });
});

async function connectToLocalServer(
  port: number,
  overrides: {
    ca?: string | undefined;
    connectionTimeoutMilliseconds?: number;
    servername?: string;
  } = {},
) {
  const ca = Object.prototype.hasOwnProperty.call(overrides, 'ca')
    ? overrides.ca
    : smtpTestCertificatePem;

  return connectImplicitTlsSmtp({
    ...(ca === undefined ? {} : { ca }),
    connectionTimeoutMilliseconds:
      overrides.connectionTimeoutMilliseconds ?? 1_000,
    host: '127.0.0.1',
    idleTimeoutMilliseconds: 1_000,
    minVersion: 'TLSv1.2',
    port,
    servername: overrides.servername ?? 'smtp.example.test',
  });
}

async function listenTlsServer(
  overrides: TlsOptions = {},
  onSecureConnection: Parameters<typeof createTlsServer>[1] = () => undefined,
): Promise<{ port: number }> {
  const server = createTlsServer(
    {
      cert: smtpTestCertificatePem,
      key: smtpTestPrivateKeyPem,
      minVersion: 'TLSv1',
      ...overrides,
    },
    onSecureConnection,
  );
  servers.push(server);

  return listen(server);
}

async function listenNetServer(
  onConnection: (socket: Socket) => void,
): Promise<{ port: number }> {
  const server = createNetServer({}, onConnection);
  servers.push(server);
  return listen(server);
}

async function listen(server: NetServer | TlsServer): Promise<{ port: number }> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Synthetic TLS server did not expose a TCP port.');
  }

  return { port: address.port };
}

async function closeServer(server: NetServer | TlsServer): Promise<void> {
  if (!server.listening) {
    return;
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for synthetic SMTP data.');
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
