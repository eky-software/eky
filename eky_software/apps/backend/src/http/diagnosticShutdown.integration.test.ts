import { mkdir, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { get } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

import * as connections from '../database/connection/createDatabaseConnection.js';
import { createBackendOperationalEvent } from '../observability/createOperationalEvent.js';
import { startServer } from './server.js';

vi.mock('node:fs/promises', async original => {
  const actual = await original<typeof import('node:fs/promises')>();
  return { ...actual, open: vi.fn(actual.open) };
});

it('drains the actual composed diagnostic reader after its HTTP client disconnects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-diagnostic-shutdown-'));
  const logsRoot = join(root, 'logs');
  await mkdir(join(logsRoot, 'backend'), { recursive: true });
  const event = createBackendOperationalEvent({ eventName: 'backend.started' }, {
    appVersion: '1.0.0', buildRevision: 'development', eventId: 'held-shutdown-read',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111', timestamp: '2026-10-24T10:00:00.000Z',
  });
  await writeFile(join(logsRoot, 'backend', 'backend-info-2026-10-001.jsonl'), `${JSON.stringify(event)}\n`);
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  const entered = deferred();
  const release = deferred();
  let fileClosed = false;
  vi.mocked(open).mockImplementation(async (...args) => {
    const handle = await actual.open(...args);
    const read = handle.read.bind(handle);
    const close = handle.close.bind(handle);
    vi.spyOn(handle, 'read').mockImplementation(async (...readArgs) => {
      fileClosed = false;
      entered.resolve();
      await release.promise;
      return Reflect.apply(read, handle, readArgs);
    });
    vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); fileClosed = true; });
    return handle;
  });
  const databases: connections.DatabaseConnection[] = [];
  const create = connections.createDatabaseConnection;
  vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
    const database = create(options);
    databases.push(database);
    return database;
  });
  const registered = vi.fn();
  const server = await startServer({ port: 0, appOptions: {
    databaseFilePath: join(root, 'synthetic.sqlite'), operationalLogsRoot: logsRoot,
    operationalLogger: { write() {} }, registerDiagnosticShutdown: registered,
  } });
  const request = get(`http://127.0.0.1:${server.port}/diagnostics/events`, response => response.resume());
  request.on('error', () => undefined);
  let closing: Promise<void> | undefined;
  let completed = false;
  let verified = false;
  try {
    await entered.promise;
    const disconnected = new Promise<void>(resolve => request.once('close', () => resolve()));
    request.destroy();
    await disconnected;
    closing = server.close().then(() => { completed = true; });
    await Promise.resolve();
    expect(registered).toHaveBeenCalledOnce();
    expect(completed).toBe(false);
    expect(fileClosed).toBe(false);
    release.resolve();
    await closing;
    expect(fileClosed).toBe(true);
    verified = true;
  } finally {
    release.resolve();
    request.destroy();
    await (closing ?? server.close());
    vi.restoreAllMocks();
    vi.mocked(open).mockReset().mockImplementation(actual.open);
    for (const database of databases) if (database.open) database.close();
    if (verified) await rm(root, { recursive: true, force: true });
  }
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
