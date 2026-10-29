import { once } from 'node:events';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { get, type RequestOptions, type Server } from 'node:http';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLocalRuntimeIdentity } from '../infrastructure/identity/localRuntimeIdentity.js';
import { createRuntimeTrustMiddleware, localRuntimeSessionHeaderName, type BackendEnvironment } from './runtimeTrust.js';
import { startServer } from './server.js';

const boundary = vi.hoisted(() => ({
  fetch: vi.fn<(request: Request) => Response | Promise<Response>>(),
  assertSecretsSettled: vi.fn<() => void>(),
  closeDiagnostics: vi.fn<() => Promise<void>>(),
  server: undefined as Server | undefined,
  sockets: new Set<Socket>(),
}));

vi.mock('./app.js', () => ({
  createApp: async (options: { registerCompanyEmailSecretShutdown?: (assertSettled: () => void) => void;
    registerDiagnosticShutdown?: (close: () => Promise<void>) => void }) => {
    options.registerCompanyEmailSecretShutdown?.(boundary.assertSecretsSettled);
    options.registerDiagnosticShutdown?.(boundary.closeDiagnostics);
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
const roots: string[] = [];
afterEach(async context => {
  for (const socket of [...clients, ...boundary.sockets]) socket.destroy();
  clients.clear();
  boundary.sockets.clear();
  if (boundary.server?.listening) {
    await new Promise<void>((resolve, reject) => boundary.server!.close(error => error ? reject(error) : resolve()));
  }
  boundary.server = undefined;
  boundary.fetch.mockReset();
  boundary.assertSecretsSettled.mockReset();
  boundary.closeDiagnostics.mockReset();
  const owned = roots.splice(0);
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass') {
      for (const root of owned) await rm(root, { recursive: true, force: true });
    }
  });
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
        timer = setTimeout(() => reject(new Error('Server close still waits after connection work settled')), 1_000);
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

async function readHttpResponse(port: number, options: Pick<RequestOptions, 'path' | 'headers'>) {
  const request = get({ host: '127.0.0.1', port, agent: false, ...options });
  request.on('socket', socket => clients.add(socket));
  try {
    const [response] = await once(request, 'response');
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    await once(response, 'end');
    return { status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) };
  } finally { request.destroy(); }
}

describe('backend HTTP adapter compatibility', () => {
  it('rejects double-decoded static paths without bypassing protected middleware', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-http-static-contract-'));
    roots.push(root);
    await mkdir(join(root, 'static', 'admin'), { recursive: true });
    await writeFile(join(root, 'static', 'public.txt'), 'synthetic public');
    await writeFile(join(root, 'static', 'admin', 'private.txt'), 'synthetic protected');
    const app = new Hono();
    app.use('/static/admin/*', async context => context.text('denied', 401));
    app.use('/static/*', serveStatic({ root }));
    boundary.fetch.mockImplementation(request => app.fetch(request));
    const server = await startServer({ port: 0 });
    expect((await readHttpResponse(server.port, { path: '/static/public.txt' })).body.toString()).toBe('synthetic public');
    expect((await readHttpResponse(server.port, { path: '/static/admin/private.txt' })).status).toBe(401);
    for (const path of ['/static/%%36%31dmin/private.txt', '/static/%25%36%31dmin/private.txt']) {
      const response = await readHttpResponse(server.port, { path });
      expect(response.status).toBe(404);
      expect(response.body.toString()).not.toContain('synthetic protected');
    }
    await expectClosed(server.close());
  });

  it.each(['missing', 'valid', 'wrong', 'duplicateValid', 'validThenWrong', 'wrongThenValid'] as const)(
    'preserves the runtime-session boundary for %s wire headers', async mode => {
      const session = 'a'.repeat(43); const wrong = 'b'.repeat(43);
      const app = new Hono<BackendEnvironment>();
      app.use('*', createRuntimeTrustMiddleware({ mode: 'localSession', sessionSecret: session }, createLocalRuntimeIdentity({
        actorId: 'local-owner', companyId: 'local-company-test', installationId: 'b'.repeat(32),
      })));
      const handler = vi.fn(() => new Response('synthetic accepted'));
      app.get('/protected', handler);
      boundary.fetch.mockImplementation(request => app.fetch(request));
      const server = await startServer({ port: 0 });
      const values = mode === 'missing' ? [] : mode === 'valid' ? [session] : mode === 'wrong' ? [wrong]
        : mode === 'duplicateValid' ? [session, session] : mode === 'validThenWrong' ? [session, wrong] : [wrong, session];
      const headers = ['Host', 'localhost', ...values.flatMap((value, index) =>
        [index === 0 ? localRuntimeSessionHeaderName : 'X-Eky-Local-Session', value])];
      const response = await readHttpResponse(server.port, { path: '/protected', headers });
      expect(response.status).toBe(mode === 'valid' ? 200 : 401);
      expect(handler).toHaveBeenCalledTimes(mode === 'valid' ? 1 : 0);
      expect(response.body.toString()).not.toContain(session);
      await expectClosed(server.close());
    },
  );

  it('preserves UTF-8 body lengths and shared frozen response headers across requests', async () => {
    const headers = Object.freeze({ 'content-type': 'text/plain; charset=utf-8', 'x-synthetic': 'preserved' });
    const bodies = ['first', '\u00e4\u00f6\u20ac', '']; let index = 0;
    const app = new Hono();
    // Keep the caller's frozen record on the adapter's cached-response path.
    app.get('/body', () => new Response(bodies[index++]!, { status: 200, headers }));
    boundary.fetch.mockImplementation(request => app.fetch(request));
    const server = await startServer({ port: 0 });
    for (const body of bodies) {
      const response = await readHttpResponse(server.port, { path: '/body' });
      expect(response.status).toBe(200);
      expect(response.body).toEqual(Buffer.from(body));
      expect(response.headers['content-length']).toBe(String(Buffer.byteLength(body)));
      expect(response.headers['x-synthetic']).toBe('preserved');
      expect(headers).toEqual({ 'content-type': 'text/plain; charset=utf-8', 'x-synthetic': 'preserved' });
    }
    await expectClosed(server.close());
  });
});

describe('backend HTTP graceful shutdown', () => {
  it('waits for the diagnostic reader after HTTP has drained', async () => {
    const release = deferred<void>();
    const entered = deferred<void>();
    boundary.closeDiagnostics.mockImplementation(async () => { entered.resolve(); await release.promise; });
    const server = await startServer({ port: 0 });
    let completed = false;
    const closing = server.close().then(() => { completed = true; });
    try {
      await entered.promise;
      expect(completed).toBe(false);
      expect(boundary.assertSecretsSettled).not.toHaveBeenCalled();
    } finally { release.resolve(); }
    await closing;
    expect(boundary.assertSecretsSettled).toHaveBeenCalledOnce();
  });

  it('still settles diagnostic work when HTTP close fails', async () => {
    const release = deferred<void>();
    const entered = deferred<void>();
    boundary.closeDiagnostics.mockImplementation(async () => { entered.resolve(); await release.promise; });
    const server = await startServer({ port: 0 });
    const failure = new Error('synthetic HTTP close failure');
    const close = vi.spyOn(boundary.server!, 'close').mockImplementation(() => { throw failure; });
    let completed = false;
    const closing = server.close().finally(() => { completed = true; });
    const rejected = expect(closing).rejects.toBe(failure);
    try {
      await entered.promise;
      expect(completed).toBe(false);
    } finally { release.resolve(); close.mockRestore(); }
    await rejected;
  });

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

  it.each(['close', 'keep-alive'] as const)('drains an accepted %s request and then closes its connection', async connection => {
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
    client.write(`GET /synthetic HTTP/1.1\r\nHost: localhost\r\nConnection: ${connection}\r\n\r\n`);
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

  it.each(['close', 'keep-alive'] as const)('finishes an accepted %s POST body without discarding the write', async connection => {
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
    client.write(`POST /synthetic HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\nConnection: ${connection}\r\n\r\na`);
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

  it.each(['separate', 'pipelined'] as const)('does not close another accepted %s request when a draining response finishes', async mode => {
    const entered = [deferred<void>(), deferred<void>()];
    const responses = [deferred<Response>(), deferred<Response>()];
    let requests = 0;
    boundary.fetch.mockImplementation(() => {
      const index = requests++;
      entered[index]!.resolve();
      return responses[index]!.promise;
    });
    const server = await startServer({ port: 0 });
    const first = await connect(server.port);
    const second = mode === 'pipelined' ? first : await connect(server.port);
    const firstChunks: Buffer[] = [];
    const secondChunks: Buffer[] = [];
    first.on('data', chunk => firstChunks.push(chunk));
    second.on('data', chunk => secondChunks.push(chunk));
    const firstClosed = once(first, 'close');
    const secondClosed = once(second, 'close');
    first.write('GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await entered[0]!.promise;
    second.write('GET /second HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await entered[1]!.promise;
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      responses[0]!.resolve(new Response('first completed'));
      if (mode === 'separate') {
        await expectClosed(firstClosed.then(() => undefined));
      } else {
        await new Promise<void>(resolve => {
          const received = () => {
            if (Buffer.concat(firstChunks).toString().includes('first completed')) {
              first.off('data', received);
              resolve();
            }
          };
          first.on('data', received);
          received();
        });
      }
      expect(closed).toBe(false);
      expect(second.destroyed).toBe(false);
      expect(boundary.assertSecretsSettled).not.toHaveBeenCalled();
      responses[1]!.resolve(new Response('second completed'));
      await expectClosed(closing);
      await secondClosed;
      expect(Buffer.concat(firstChunks).toString()).toContain('first completed');
      expect(Buffer.concat(secondChunks).toString()).toContain('second completed');
      expect(boundary.fetch).toHaveBeenCalledTimes(2);
      expect(boundary.assertSecretsSettled).toHaveBeenCalledOnce();
    } finally {
      responses[0]!.resolve(new Response('first completed'));
      responses[1]!.resolve(new Response('second completed'));
    }
  });

  it.each(['separate', 'pipelined'] as const)('preserves an incomplete %s POST while another response finishes', async mode => {
    const firstEntered = deferred<void>();
    const postEntered = deferred<void>();
    const firstResponse = deferred<Response>();
    const writes: string[] = [];
    boundary.fetch.mockImplementation(async request => {
      if (request.method === 'POST') {
        postEntered.resolve();
        writes.push(await request.text());
        return new Response('write preserved');
      }
      firstEntered.resolve();
      return firstResponse.promise;
    });
    const server = await startServer({ port: 0 });
    const first = await connect(server.port);
    const second = mode === 'pipelined' ? first : await connect(server.port);
    const firstChunks: Buffer[] = [];
    const secondChunks: Buffer[] = [];
    const firstReceived = deferred<void>();
    first.on('data', chunk => {
      firstChunks.push(chunk);
      if (Buffer.concat(firstChunks).toString().includes('first completed')) firstReceived.resolve();
    });
    second.on('data', chunk => secondChunks.push(chunk));
    const secondClosed = once(second, 'close');
    first.write('GET /first HTTP/1.1\r\nHost: localhost\r\n\r\n');
    await firstEntered.promise;
    second.write('POST /second HTTP/1.1\r\nHost: localhost\r\nContent-Length: 4\r\n\r\na');
    await postEntered.promise;
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      firstResponse.resolve(new Response('first completed'));
      await firstReceived.promise;
      expect(closed).toBe(false);
      expect(second.destroyed).toBe(false);
      expect(writes).toEqual([]);
      expect(boundary.assertSecretsSettled).not.toHaveBeenCalled();
      second.write('bcd');
      await expectClosed(closing);
      await secondClosed;
      expect(writes).toEqual(['abcd']);
      expect(Buffer.concat(secondChunks).toString()).toContain('write preserved');
      expect(boundary.assertSecretsSettled).toHaveBeenCalledOnce();
    } finally {
      firstResponse.resolve(new Response('first completed'));
    }
  });

  it('preserves every byte of a streaming response when shutdown overlaps a paused reader', async () => {
    const body = Buffer.alloc(2 * 1024 * 1024, 0x61);
    body[body.length - 1] = 0x7a;
    const release = deferred<void>();
    boundary.fetch.mockImplementation(() => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(body.subarray(0, 65536)); },
      async pull(controller) {
        await release.promise;
        controller.enqueue(body.subarray(65536));
        controller.close();
      },
    }), { headers: { 'Content-Length': String(body.length) } }));
    const server = await startServer({ port: 0 });
    const request = get({ host: '127.0.0.1', port: server.port, path: '/stream', agent: false,
      headers: { Connection: 'keep-alive' } });
    request.on('socket', socket => clients.add(socket));
    const [response] = await once(request, 'response');
    response.pause();
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    const received = once(response, 'end');
    let closed = false;
    const closing = server.close().then(() => { closed = true; });
    try {
      await new Promise<void>(resolve => setImmediate(resolve));
      expect(closed).toBe(false);
      expect(chunks).toEqual([]);
      release.resolve();
      response.resume();
      await received;
      await expectClosed(closing);
      expect(Buffer.concat(chunks).equals(body)).toBe(true);
      expect(boundary.assertSecretsSettled).toHaveBeenCalledOnce();
    } finally {
      release.resolve();
      response.destroy();
      request.destroy();
    }
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
