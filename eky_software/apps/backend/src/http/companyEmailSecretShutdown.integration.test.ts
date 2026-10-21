import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createConnection as connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../database/connection/createDatabaseConnection.js';
import { SqliteCompanyEmailSecretAuditWriter } from '../modules/companySettings/infrastructure/sqliteCompanyEmailSecretAuditWriter.js';
import type { CompanyEmailSecretStore } from '../modules/companySettings/ports/companyEmailSecretStore.js';
import { CompanyEmailSecretStoreError } from '../modules/companySettings/ports/companyEmailSecretStoreError.js';
import type { BackendOperationalEvent } from '../observability/operationalEvent.js';
import * as application from './app.js';
import { startServer, type StartedServer } from './server.js';

type Action = 'set' | 'remove';
type Outcome = 'success' | 'noEffect' | 'unknown';
const cleanup: Array<(failed: boolean) => Promise<void>> = [];

afterEach(async context => {
  try {
    for (const dispose of cleanup.splice(0)) await dispose(context.task.result?.state !== 'pass');
  } finally {
    vi.restoreAllMocks();
  }
});

describe('real HTTP secret mutation and audit shutdown', () => {
  it.each(['set', 'remove'] as const)(
    'does not accept disconnected %s work as a clean shutdown', async action => {
      const f = await fixture('store', 'success');
      const socket = await f.send(action);
      await f.entered.promise;
      expect(f.audit()).toEqual([{ action, status: 'pending' }]);
      expect(f.calls).toHaveLength(1);
      const disconnected = once(socket, 'close');
      socket.destroy();
      await disconnected;

      await expect(f.close()).rejects.toMatchObject({ code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' });
      expect(f.events.some(event => event.eventName === 'backend.shutdownCompleted')).toBe(false);
      expect(f.audit()).toEqual([{ action, status: 'pending' }]);
      f.release.resolve();
      await f.settleRequests();
      expect(f.audit()).toEqual([{ action, status: 'succeeded' }]);
      expect(f.calls).toHaveLength(1);
      // Late completion is evidence for that request, not permission to reuse its runtime.
      expect(f.assertSettled).toThrow(expect.objectContaining({ code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' }));
    },
  );

  it.each(['set', 'remove'] as const)(
    'requires final audit after %s store completion even when HTTP disconnects', async action => {
      const f = await fixture('audit', 'success');
      const socket = await f.send(action);
      await f.entered.promise;
      expect(f.calls).toHaveLength(1);
      expect(f.audit()).toEqual([{ action, status: 'pending' }]);
      const disconnected = once(socket, 'close');
      socket.destroy();
      await disconnected;
      await expect(f.close()).rejects.toMatchObject({ code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' });
      f.release.resolve();
      await f.settleRequests();
      expect(f.audit()).toEqual([{ action, status: 'succeeded' }]);
      expect(f.assertSettled).toThrow();
      expect(f.events.some(event => event.eventName === 'backend.shutdownCompleted')).toBe(false);
    },
  );

  it.each((['success', 'noEffect', 'unknown'] as const).flatMap(outcome =>
    (['close', 'keep-alive'] as const).map(connection => [outcome, connection] as const),
  ))(
    'keeps the actual %s outcome for a %s request during shutdown', async (outcome, connection) => {
      const f = await fixture('store', outcome);
      const socket = await f.send('set', connection);
      const chunks: Buffer[] = [];
      socket.on('data', chunk => chunks.push(chunk));
      const disconnected = once(socket, 'close');
      await f.entered.promise;
      let closed = false;
      let auditAtClose: ReturnType<typeof f.audit> | undefined;
      const closing = f.close().then(
        () => { closed = true; auditAtClose = f.audit(); return { ok: true as const }; },
        (error: unknown) => { closed = true; auditAtClose = f.audit(); return { ok: false as const, error }; },
      );
      // Observe the actual listener boundary before allowing the held work to finish.
      await f.expectListenerClosed();
      expect(closed).toBe(false);
      expect(f.audit()).toEqual([{ action: 'set', status: 'pending' }]);
      f.release.resolve();
      await f.settleRequests();
      await disconnected;
      const result = await closing;
      expect(result.ok).toBe(outcome !== 'unknown');
      if (outcome === 'unknown') {
        expect(result).toMatchObject({ error: { code: 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' } });
      }
      expect(f.audit()).toEqual([{ action: 'set', status: outcome === 'success' ? 'succeeded' : outcome === 'noEffect' ? 'failed' : 'pending' }]);
      expect(auditAtClose).toEqual(f.audit());
      const response = Buffer.concat(chunks).toString('utf8');
      expect(response).toContain(outcome === 'success' ? '200 OK' : '503 Service Unavailable');
      if (outcome !== 'success') {
        expect(response).toContain(outcome === 'unknown'
          ? 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN' : 'COMPANY_EMAIL_SECRET_OPERATION_FAILED');
      }
      expect(response).not.toContain('synthetic-http-secret');
      expect(f.events.some(event => event.eventName === 'backend.shutdownCompleted')).toBe(outcome !== 'unknown');
      expect(f.calls).toHaveLength(1);
    },
  );
});

async function fixture(hold: 'store' | 'audit', outcome: Outcome) {
  const root = await mkdtemp(join(tmpdir(), 'eky-secret-http-close-'));
  const databases: connections.DatabaseConnection[] = [];
  const sockets: Socket[] = [];
  const requests: Promise<Response>[] = [];
  const entered = gate();
  const release = gate();
  const events: BackendOperationalEvent[] = [];
  const calls: Array<{ companyId: string; operationId: string | undefined }> = [];
  let server: StartedServer | undefined;
  let closeTask: Promise<void> | undefined;
  const close = () => {
    if (server === undefined) throw new Error('Synthetic HTTP server missing.');
    return closeTask ??= server.close();
  };
  let settled: (() => void) | undefined;
  const createConnection = connections.createDatabaseConnection;
  vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
    const database = createConnection(options);
    databases.push(database);
    return database;
  });
  // Observe real handler completion without replacing routes, trust, audit or HTTP behavior.
  const createApp = application.createApp;
  vi.spyOn(application, 'createApp').mockImplementation(async options => {
    const app = await createApp(options);
    const fetch = app.fetch;
    app.fetch = (...args: Parameters<typeof fetch>) => {
      const request = Promise.resolve(fetch(...args));
      requests.push(request);
      return request;
    };
    return app;
  });
  cleanup.push(async failed => {
    const errors: unknown[] = [];
    release.resolve();
    for (const socket of sockets) socket.destroy();
    for (const result of await Promise.allSettled(requests)) {
      if (result.status === 'rejected') errors.push(result.reason);
    }
    // This safe code is raised only after the actual HTTP listener has closed.
    try {
      if (server !== undefined) await close();
    } catch (error) {
      if (!(error instanceof Error && 'code' in error &&
        error.code === 'COMPANY_EMAIL_SECRET_OUTCOME_UNKNOWN')) errors.push(error);
    }
    for (const database of databases) {
      try { if (database.open) database.close(); } catch (error) { errors.push(error); }
    }
    if (!failed && errors.length === 0) await rm(root, { recursive: true });
    if (errors.length > 0) throw new AggregateError(errors, 'Synthetic HTTP cleanup failed.');
  });
  const mutate = async (companyId: string, operationId?: string) => {
    calls.push({ companyId, operationId });
    if (hold === 'store') {
      entered.resolve();
      await release.promise;
    }
    if (outcome !== 'success') throw new CompanyEmailSecretStoreError(outcome);
  };
  const store: CompanyEmailSecretStore = {
    hasSecret: async () => false,
    setSecret: input => mutate(input.companyId, input.operationId),
    removeSecret: mutate,
  };
  if (hold === 'audit') {
    const complete = SqliteCompanyEmailSecretAuditWriter.prototype.completeCompanyEmailSecretAuditOperation;
    vi.spyOn(SqliteCompanyEmailSecretAuditWriter.prototype, 'completeCompanyEmailSecretAuditOperation')
      .mockImplementation(async function (this: SqliteCompanyEmailSecretAuditWriter, completion) {
        entered.resolve();
        await release.promise;
        return complete.call(this, completion);
      });
  }
  const session = randomBytes(32).toString('base64url');
  server = await startServer({
    port: 0,
    runtimeTrust: { mode: 'localSession', sessionSecret: session },
    appOptions: {
      databaseFilePath: join(root, 'profile.sqlite'),
      invoiceDocumentStorageRoot: join(root, 'invoices'),
      companyEmailSecretStore: store,
      operationalLogger: { write: event => { events.push(event); } },
      registerCompanyEmailSecretShutdown: value => { settled = value; },
    },
  });
  const runtimeDatabase = databases.find(database => database.open);
  if (runtimeDatabase === undefined || settled === undefined) throw new Error('Synthetic HTTP runtime was not registered.');
  const assertSettled = settled;
  return {
    close, entered, release, events, calls, assertSettled,
    settleRequests: () => Promise.all(requests),
    expectListenerClosed: () => new Promise<void>((resolve, reject) => {
      const probe = connect({ host: '127.0.0.1', port: server!.port });
      sockets.push(probe);
      probe.once('connect', () => {
        probe.destroy();
        reject(new Error('Synthetic listener still accepts connections during shutdown.'));
      });
      probe.once('error', error => {
        if ('code' in error && error.code === 'ECONNREFUSED') resolve();
        else reject(error);
      });
    }),
    audit() {
      const rows = runtimeDatabase.prepare('SELECT operation_id, company_id, action, status FROM company_email_secret_audit_events').all() as
        Array<{ operation_id: string; company_id: string; action: Action; status: string }>;
      expect(rows).toHaveLength(1);
      expect(calls).toEqual([{ companyId: rows[0]!.company_id, operationId: rows[0]!.operation_id }]);
      return rows.map(({ action, status }) => ({ action, status }));
    },
    async send(action: Action, connection: 'close' | 'keep-alive' = 'close') {
      const socket = connect({ host: '127.0.0.1', port: server!.port });
      sockets.push(socket);
      await once(socket, 'connect');
      const body = action === 'set' ? JSON.stringify({ secret: 'synthetic-http-secret' }) : '';
      socket.write([
        `${action === 'set' ? 'PUT' : 'DELETE'} /company-settings/email-secret HTTP/1.1`,
        'Host: localhost', `Connection: ${connection}`, 'Content-Type: application/json',
        `x-eky-local-session: ${session}`, `Content-Length: ${Buffer.byteLength(body)}`, '', body,
      ].join('\r\n'));
      return socket;
    },
  };
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}
