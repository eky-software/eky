import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

import { createHttpRequestFailureCapture } from '../../../../test-reporters/httpRequestFailureCapture.mjs';
import * as connections from '../database/connection/createDatabaseConnection.js';
import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import { createApp } from './app.js';
import { readDiagnosticHttpPageForTest } from '../modules/diagnostics/diagnosticHttpRead.fixture.js';
import { setHttpRequestOperation } from './httpRequestOperationalContext.js';
import { correlationIdHeaderName } from './operationalLogging.js';
import { localRuntimeSessionHeaderName } from './runtimeTrust.js';

const roots: string[] = [];
const databases: connections.DatabaseConnection[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases.splice(0)) if (database.open) database.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

it.for(['error', 'nonError', 'unfinalized'])('wires the %s boundary into createApp and the real diagnostic readers', async (kind, testContext) => {
  const root = await prepareDatabaseCapture();
  const capture = createHttpRequestFailureCapture(testContext);
  const observer = { captureOriginalException: vi.fn(capture.captureOriginalException) };
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const app = await createApp({
    databaseFilePath: join(root, 'synthetic.sqlite'),
    operationalLogsRoot: join(root, 'logs'),
    httpRequestFailureObserver: observer,
  });
  const error = kind === 'error' ? new Error('F_PRIVATE_MESSAGE') : 'F_PRIVATE_MESSAGE';
  app.get('/synthetic-failure', async context => {
    setHttpRequestOperation(context, 'invoiceDraft.create', 'requestValidation');
    if (kind === 'unfinalized') return;
    throw error;
  });
  const response = await app.request('/synthetic-failure?private=F_PRIVATE_QUERY');
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: 'Internal server error.' });
  const correlationId = response.headers.get(correlationIdHeaderName);
  expect(correlationId).toMatch(/^[a-f0-9-]{36}$/i);
  expect(observer.captureOriginalException.mock.calls.length).toBe(1);
  if (kind !== 'unfinalized') {
    expect(observer.captureOriginalException.mock.calls[0]?.[0] === error).toBe(true);
  }

  const diagnosticData = await readDiagnosticHttpPageForTest(app);
  const bundleResponse = await app.request('/diagnostics/support-bundle-data');
  expect(bundleResponse.status).toBe(200);
  const bundleData = await bundleResponse.json();
  for (const data of [diagnosticData, bundleData]) {
    expect(data.diagnosticEvents.filter((event: { eventName: string }) =>
      event.eventName === 'http.requestFailed')).toEqual([expect.objectContaining({
      correlationId, errorCode: 'HTTP_HANDLER_FAILED',
      operationId: 'invoiceDraft.create', stage: 'requestValidation',
    })]);
    expect(JSON.stringify(data)).not.toContain('F_PRIVATE');
    expect(JSON.stringify(data)).not.toContain(root);
  }
  expect(consoleError).not.toHaveBeenCalled();
  expect((await app.request('/health')).status).toBe(200);
});

it.each([false, true])('preserves createApp 401/404 results when HTTP writes fail afterEffect=%s', async afterEffect => {
  const root = await prepareDatabaseCapture();
  let failWrites = false;
  const recorded: BackendOperationalEvent[] = [];
  const write = vi.fn((event: BackendOperationalEvent) => {
    if (!failWrites || afterEffect) recorded.push(event);
    if (failWrites) throw new Error('F_PRIVATE_WRITER_ERROR');
  });
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const observer = { captureOriginalException: vi.fn() };
  const sessionSecret = 'a'.repeat(43);
  const app = await createApp({
    databaseFilePath: join(root, 'synthetic.sqlite'), operationalLogger: { write },
    httpRequestFailureObserver: observer,
    runtimeTrust: { mode: 'localSession', sessionSecret },
  });
  failWrites = true;
  for (const [session, status, eventName] of [
    [undefined, 401, 'runtimeSession.missing'],
    ['b'.repeat(43), 401, 'runtimeSession.invalid'],
    [sessionSecret, 404, 'http.unknownRoute'],
  ] as const) {
    write.mockClear();
    recorded.splice(0);
    const response = await app.request('/synthetic-unknown', {
      headers: session === undefined ? {} : { [localRuntimeSessionHeaderName]: session },
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({
      error: status === 401 ? 'Authentication required.' : 'Not found.',
    });
    expect(response.headers.get(correlationIdHeaderName)).toMatch(/^[a-f0-9-]{36}$/i);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith(expect.objectContaining({ eventName }));
    expect(recorded.length).toBe(afterEffect ? 1 : 0);
  }
  expect((await app.request('/health')).status).toBe(200);
  expect(observer.captureOriginalException).not.toHaveBeenCalled();
  expect(consoleError).not.toHaveBeenCalled();
});

async function prepareDatabaseCapture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-http-error-'));
  roots.push(root);
  const create = connections.createDatabaseConnection;
  vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
    const database = create(options);
    databases.push(database);
    return database;
  });
  return root;
}
