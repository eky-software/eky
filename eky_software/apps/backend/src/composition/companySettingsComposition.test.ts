import { createActorContext, type ActorContext } from '@eky/auth';
import Database from 'better-sqlite3';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DatabaseConnection } from '../database/connection/createDatabaseConnection.js';
import { runMigrations } from '../database/migration/runMigrations.js';
import {
  correlationIdHeaderName,
  createOperationalLoggingMiddleware,
} from '../http/operationalLogging.js';
import type { BackendEnvironment } from '../http/runtimeTrust.js';
import { createEmptyCompanySettings } from '../modules/companySettings/domain/companySettings.js';
import { createCompanySettingsAuditEvent } from '../modules/companySettings/domain/companySettingsAuditEvent.js';
import { SqliteCompanySettingsRepository } from '../modules/companySettings/infrastructure/sqliteCompanySettingsRepository.js';
import type { CompanyEmailSecretStore } from '../modules/companySettings/ports/companyEmailSecretStore.js';
import { CompanySettingsAuditWriteError } from '../modules/companySettings/ports/companySettingsAuditWriteError.js';
import type { OperationalLogger } from '../observability/operationalLogger.js';
import { createCompanySettingsComposition } from './companySettingsComposition.js';

const companyId = 'synthetic-company';
const actorContext = createActorContext({
  actorId: 'synthetic-owner',
  authenticationMode: 'local',
  companyId,
  permissions: ['manageCompanySettings'],
});
const operationalIdentity = {
  appVersion: '0.0.0',
  buildRevision: '123456789abc',
  runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
} as const;
const correlationId = '7f62df6c-9122-4ac7-8d0f-b8ed214ee97b';

describe('Company Settings save composition', () => {
  let database: DatabaseConnection;
  let repository: SqliteCompanySettingsRepository;

  beforeEach(async () => {
    database = new Database(':memory:');
    await runMigrations(database);
    repository = new SqliteCompanySettingsRepository(database);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    database.close();
  });

  it.each([false, true])('keeps settings and audit untouched while status is pending (existing: %s)', async (existing) => {
    if (existing) await seedSettings();
    const before = readState();
    const entered = createDeferred<void>();
    const status = createDeferred<boolean>();
    const hasSecret = vi.fn(async () => {
      entered.resolve();
      return status.promise;
    });
    const { app, write } = createTestApp({ store: createSecretStore(hasSecret) });
    let completed = false;
    const request = save(app).then((response) => {
      completed = true;
      return response;
    });

    try {
      await Promise.race([
        entered.promise,
        request.then(() => { throw new Error('Save completed before status lookup.'); }),
      ]);
      expect(completed).toBe(false);
      expect(readState()).toEqual(before);
      expect(database.inTransaction).toBe(false);
      expect(write).not.toHaveBeenCalled();

      status.resolve(true);
      const response = await request;
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        companySettings: { companyName: 'Synthetic Updated Company', emailSecretConfigured: true },
      });
      expect(readState().settings).toHaveLength(1);
      expect(readState().audit).toHaveLength(before.audit.length + 1);
      expect(hasSecret).toHaveBeenCalledExactlyOnceWith(companyId);
    } finally {
      status.resolve(true);
      await request;
    }
  });

  it.each([false, true])('rejects failed status without changing data or audit and permits a safe retry (existing: %s)', async (existing) => {
    if (existing) await seedSettings();
    const before = readState();
    const error = new Error('synthetic-secret-value sender@example.test /synthetic/private/file');
    error.stack = 'SYNTHETIC_PRIVATE_STACK';
    const entered = createDeferred<void>();
    const status = createDeferred<boolean>();
    const hasSecret = vi.fn(async () => {
      entered.resolve();
      return status.promise;
    });
    const { app, write } = createTestApp({ store: createSecretStore(hasSecret) });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const request = save(app);

    try {
      await Promise.race([
        entered.promise,
        request.then(() => { throw new Error('Save completed before status lookup.'); }),
      ]);
      expect(readState()).toEqual(before);
      status.reject(error);
      const response = await request;
      expect(response.status).toBe(500);
      expect(await response.text()).toBe('Internal Server Error');
      expect(response.headers.get(correlationIdHeaderName)).toBe(correlationId);
      expect(readState()).toEqual(before);
      expect(write).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
        correlationId,
        errorCode: 'HTTP_REQUEST_FAILED',
        eventName: 'http.requestFailed',
        stage: 'response',
      }));
      const logged = JSON.stringify(write.mock.calls);
      for (const forbidden of [
        error.message, error.stack, 'synthetic-secret-value', 'sender@example.test',
        '/synthetic/private/file', 'Synthetic Updated Company', companyId,
      ]) {
        expect(logged).not.toContain(forbidden);
      }

      hasSecret.mockResolvedValue(false);
      const retry = await save(app);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        companySettings: { emailSecretConfigured: false },
      });
      expect(readState().audit).toHaveLength(before.audit.length + 1);
      expect(hasSecret).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenCalledTimes(1);
    } finally {
      status.resolve(false);
      await request;
    }
  });

  it.each([true, false, undefined])('returns captured status %s with the actual persisted record, without a post-commit lookup', async (configured) => {
    await seedSettings();
    const original = await repository.findByCompanyId(companyId);
    const before = readState();
    const hasSecret = vi.fn(async () => {
      expect(readState()).toEqual(before);
      return configured ?? false;
    });
    const { app, write } = createTestApp(
      configured === undefined ? {} : { store: createSecretStore(hasSecret) },
    );

    const response = await save(app);

    expect(response.status).toBe(200);
    const saved = await repository.findByCompanyId(companyId);
    expect(saved).toMatchObject({
      id: original?.id,
      createdAt: original?.createdAt,
      companyName: 'Synthetic Updated Company',
      emailSecretConfigured: false,
    });
    expect(await response.json()).toEqual({
      companySettings: { ...saved, emailSecretConfigured: configured ?? false },
    });
    expect(readState().audit).toHaveLength(before.audit.length + 1);
    expect(hasSecret).toHaveBeenCalledTimes(configured === undefined ? 0 : 1);
    if (configured !== undefined) expect(hasSecret).toHaveBeenCalledWith(companyId);
    expect(write).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'denied actor', denied: true, body: {}, status: 403 },
    { name: 'injected company', denied: false, body: { companyId: 'other-company' }, status: 400 },
    { name: 'injected actor', denied: false, body: { actorContext }, status: 400 },
    { name: 'wrong field type', denied: false, body: { streetAddress: 42 }, status: 400 },
    { name: 'invalid last field', denied: false, body: { streetAddress: 'x'.repeat(201) }, status: 400 },
  ])('rejects $name before contacting the store or mutating data', async ({ denied, body, status }) => {
    await seedSettings();
    const before = readState();
    const hasSecret = vi.fn(async () => true);
    const { app } = createTestApp({
      actor: denied ? createActorContext({ ...actorContext, permissions: [] }) : actorContext,
      store: createSecretStore(hasSecret),
    });

    const response = await save(app, body);

    expect(response.status).toBe(status);
    expect(hasSecret).not.toHaveBeenCalled();
    expect(readState()).toEqual(before);
  });

  it.each([false, true])('keeps mandatory audit rollback and safe errors when the operational writer fails: %s', async (loggerFails) => {
    await seedSettings();
    const before = readState();
    database.exec(`
      CREATE TEMP TRIGGER reject_company_settings_audit
      BEFORE INSERT ON company_settings_audit_events
      BEGIN
        SELECT RAISE(ABORT, 'synthetic private audit failure');
      END;
    `);
    const hasSecret = vi.fn(async () => true);
    const write = vi.fn<OperationalLogger['write']>((event) => {
      if (loggerFails && event.eventName === 'businessAudit.writeFailed') {
        throw new Error('synthetic private logger failure');
      }
    });
    const { app } = createTestApp({ store: createSecretStore(hasSecret), write });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await save(app);

    expect(response.status).toBe(500);
    expect(await response.text()).toBe('Internal Server Error');
    expect(readState()).toEqual(before);
    expect(database.inTransaction).toBe(false);
    expect(hasSecret).toHaveBeenCalledExactlyOnceWith(companyId);
    expect(consoleError).toHaveBeenCalledExactlyOnceWith(
      expect.any(CompanySettingsAuditWriteError),
    );
    expect(write.mock.calls).toEqual([
      [expect.objectContaining({
        entityType: 'companySettings',
        errorCode: 'COMPANY_SETTINGS_AUDIT_WRITE_FAILED',
        eventName: 'businessAudit.writeFailed',
        sideEffectState: 'rolledBack',
        stage: 'companySettingsMutation',
      })],
      [expect.objectContaining({ eventName: 'http.requestFailed' })],
    ]);
    expect(JSON.stringify(write.mock.calls)).not.toContain('synthetic private');
  });

  it.each([true, false, undefined])('preserves GET status behavior with configured=%s and writes no audit', async (configured) => {
    await seedSettings();
    const before = readState();
    const hasSecret = vi.fn(async () => configured ?? false);
    const { app, write } = createTestApp(
      configured === undefined ? {} : { store: createSecretStore(hasSecret) },
    );

    const response = await app.request('/company-settings');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      companySettings: { companyName: 'Synthetic Original Company', emailSecretConfigured: configured ?? false },
    });
    expect(hasSecret).toHaveBeenCalledTimes(configured === undefined ? 0 : 1);
    expect(readState()).toEqual(before);
    expect(write).not.toHaveBeenCalled();
  });

  async function seedSettings(): Promise<void> {
    const settings = {
      ...createEmptyCompanySettings(companyId),
      id: 'synthetic-existing-settings',
      companyName: 'Synthetic Original Company',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    await repository.upsertCompanySettings(settings, createCompanySettingsAuditEvent({
      actorUserId: actorContext.actorId,
      current: null,
      updated: settings,
    }));
  }

  function readState() {
    return {
      settings: database.prepare('SELECT * FROM company_settings ORDER BY company_id').all(),
      audit: database.prepare('SELECT * FROM company_settings_audit_events ORDER BY id').all(),
    };
  }

  function createTestApp(options: {
    actor?: ActorContext;
    store?: CompanyEmailSecretStore;
    write?: OperationalLogger['write'];
  } = {}) {
    const write = vi.fn<OperationalLogger['write']>(options.write ?? (() => undefined));
    const logging = { operationalIdentity, operationalLogger: { write } };
    const composition = createCompanySettingsComposition({
      database,
      ...logging,
      ...(options.store === undefined ? {} : { companyEmailSecretStore: options.store }),
    });
    const app = new Hono<BackendEnvironment>();
    app.use('*', createOperationalLoggingMiddleware(logging));
    app.use('*', async (context, next) => {
      context.set('actorContext', options.actor ?? actorContext);
      await next();
    });
    app.route('/', composition.routes);
    return { app, write };
  }
});

function createSecretStore(hasSecret: CompanyEmailSecretStore['hasSecret']): CompanyEmailSecretStore {
  return {
    hasSecret,
    setSecret: vi.fn(async () => undefined),
    removeSecret: vi.fn(async () => undefined),
  };
}

function save(app: Hono<BackendEnvironment>, body: Record<string, unknown> = {}): Promise<Response> {
  return Promise.resolve(app.request('/company-settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', [correlationIdHeaderName]: correlationId },
    body: JSON.stringify({ companyName: '  Synthetic Updated Company  ', ...body }),
  }));
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
