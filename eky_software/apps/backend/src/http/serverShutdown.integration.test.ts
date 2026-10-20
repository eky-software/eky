import { once } from 'node:events';
import type { Server } from 'node:http';
import { createConnection, type Socket } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startServer } from './server.js';

const boundary = vi.hoisted(() => ({
  fetch: vi.fn<(request: Request) => Response | Promise<Response>>(),
  assertSecretsSettled: vi.fn<() => void>(),
  server: undefined as Server | undefined,
  sockets: new Set<Socket>(),
}));

vi.mock('./app.js', () => ({
  createApp: async (options: { registerCompanyEmailSecretShutdown?: (assertSettled: () => void) => void }) => {
    options.registerCompanyEmailSecretShutdown?.(boundary.assertSecretsSettled);
    return { fetch: boundary.fetch };
  },
}));
vi.mock('@hono/node-server', async importOriginal => {
  const actual = await importOriginal<typeof import('@hono/node-server')>();
  return {
    ...actual,
    serve: (...args: Parameters<typeof actual.serve>) => {
      const server = actual.serve(...args) as Server;
      boundary.server = server;
      server.on('connection', socket => {
        boundary.sockets.add(socket);
        socket.once('close', () => boundary.sockets.delete(socket));
      });
      return server;
    },
  };
});

const clients = new Set<Socket>();
afterEach(async () => {
  for (const socket of [...clients, ...boundary.sockets]) socket.destroy();
  clients.clear();
  boundary.sockets.clear();
  if (boundary.server?.listening) {
    await new Promise<void>((resolve, reject) => boundary.server!.close(error => error ? reject(error) : resolve()));
  }
  boundary.server = undefined;
  boundary.fetch.mockReset();
  boundary.assertSecretsSettled.mockReset();
});

async function connect(port: number): Promise<Socket> {
  const accepted = once(boundary.server!, 'connection');
  const client = createConnection({ host: '127.0.0.1', port });
  clients.add(client);
  await Promise.all([accepted, once(client, 'connect')]);
  return client;
}

async function expectClosed(close: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      close,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Server close still waits for an unused connection')), 1_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe('backend HTTP graceful shutdown', () => {
  it('does not treat a disconnected request as settled application work', async () => {
    const entered = deferred<void>();
    const response = deferred<Response>();
    boundary.fetch.mockImplementation(async () => {
      entered.resolve();
      return response.promise;
    });
    const unsettled = new Error('synthetic secret operation is still active');
    boundary.assertSecretsSettled.mockImplementation(() => { throw unsettled; });
    const server = await startServer({ port: 0 });
    const client = await connect(server.port);
    client.on('error', () => undefined);
    client.write('GET /synthetic HTTP/1.1\r\nHost: localhost\r\n\r\n');
    try {
      await entered.promise;
      const disconnected = once(client, 'close');
      client.destroy();
      await disconnected;
      await expect(server.close()).rejects.toBe(unsettled);
      expect(boundary.assertSecretsSettled).toHaveBeenCalledOnce();
    } finally {
      response.resolve(new Response('synthetic late response'));
    }
  });
  it.each(['connected', 'partialHeaders'] as const)(
    'closes a %s connection that has not reached an application request', async state => {
      boundary.fetch.mockResolvedValue(new Response('unused'));
      const server = await startServer({ port: 0 });
      const client = await connect(server.port);
      if (state === 'partialHeaders') {
        const received = once([...boundary.sockets][0]!, 'data');
        client.write('GET /synthetic HTTP/1.1\r\nHost: localhost\r\n');
        await received;
      }
      const disconnected = once(client, 'close');
      client.resume();
      await expectClosed(server.close());
      await disconnected;
      expect(boundary.fetch).not.toHaveBeenCalled();
    },
  );

  it('keeps an accepted request alive until its response finishes', async () => {
    const entered = deferred<void>();
    const response = deferred<Response>();
    boundary.fetch.mockImplementation(async () => {
      entered.resolve();
      return response.promise;
    });
    const server = await startServer({ port: 0 });
    const client = await connect(server.port);
    const chunks: Buffer[] = [];
    client.on('data', chunk => chunks.push(chunk));
    const clientClosed = once(client, 'close');
    client.write('GET /synthetic HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    await entered.promise;
    const unused = await connect(server.port);
    unused.resume();
    const unusedClosed = once(unused, 'close');
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      await expectClosed(unusedClosed.then(() => undefined));
      expect(closed).toBe(false);
      expect(client.destroyed).toBe(false);
      const lateClient = createConnection({ host: '127.0.0.1', port: server.port });
      clients.add(lateClient);
      const [lateError] = await once(lateClient, 'error');
      expect(lateError).toMatchObject({ code: 'ECONNREFUSED' });
      expect(boundary.fetch).toHaveBeenCalledOnce();
      response.resolve(new Response('synthetic response retained'));
      await expectClosed(closing);
      await clientClosed;
      expect(Buffer.concat(chunks).toString()).toContain('synthetic response retained');
      expect(boundary.fetch).toHaveBeenCalledOnce();
    } finally {
      response.resolve(new Response('synthetic response retained'));
    }
  });

  it('finishes an accepted POST body before closing without discarding the write', async () => {
    const entered = deferred<void>();
    const writes: string[] = [];
    boundary.fetch.mockImplementation(async request => {
      entered.resolve();
      writes.push(await request.text());
      return new Response('write completed');
    });
    const server = await startServer({ port: 0 });
    const client = await connect(server.port);
    const chunks: Buffer[] = [];
    client.on('data', chunk => chunks.push(chunk));
    const clientClosed = once(client, 'close');
    client.write('POST /synthetic HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\nConnection: close\r\n\r\na');
    await entered.promise;
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(closed).toBe(false);
    expect(client.destroyed).toBe(false);
    expect(writes).toEqual([]);
    client.write('bcd');
    await expectClosed(closing);
    await clientClosed;
    expect(writes).toEqual(['abcd']);
    expect(Buffer.concat(chunks).toString()).toContain('write completed');
  });

  it('closes a completed keep-alive connection through normal HTTP shutdown', async () => {
    boundary.fetch.mockResolvedValue(new Response('completed'));
    const server = await startServer({ port: 0 });
    const client = await connect(server.port);
    const finished = new Promise<void>(resolve => {
      let text = '';
      client.on('data', chunk => {
        text += chunk.toString();
        if (text.includes('completed')) resolve();
      });
    });
    client.write('GET /synthetic HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await finished;
    const disconnected = once(client, 'close');
    await expectClosed(server.close());
    await disconnected;
    expect(boundary.fetch).toHaveBeenCalledOnce();
  });

  it('marks a request as accepted before its handler can begin shutdown', async () => {
    let closing: Promise<void> | undefined;
    const server = await startServer({ port: 0 });
    boundary.fetch.mockImplementation(() => {
      closing = server.close();
      return new Response('response from closing handler');
    });
    const client = await connect(server.port);
    const chunks: Buffer[] = [];
    client.on('data', chunk => chunks.push(chunk));
    const disconnected = once(client, 'close');
    client.write('GET /synthetic HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n');
    await expectClosed(disconnected.then(() => undefined));
    expect(closing).toBeDefined();
    await closing;
    expect(Buffer.concat(chunks).toString()).toContain('response from closing handler');
  });

  it('stops accepting new connections once graceful shutdown starts', async () => {
    boundary.fetch.mockResolvedValue(new Response('unused'));
    const server = await startServer({ port: 0 });
    await expectClosed(server.close());
    const client = createConnection({ host: '127.0.0.1', port: server.port });
    clients.add(client);
    const [error] = await once(client, 'error');
    expect(error).toMatchObject({ code: 'ECONNREFUSED' });
    expect(boundary.fetch).not.toHaveBeenCalled();
  });
});
