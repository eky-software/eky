import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  desktopBackendReadinessTimeoutMilliseconds,
  parseDesktopBackendCommand,
  parseDesktopBackendStatus,
} from './backendMessages.js';

const generationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

describe('desktop backend process messages', () => {
  it('shares the existing readiness budget without adding a stage timeout', () => {
    expect(desktopBackendReadinessTimeoutMilliseconds).toBe(30_000);
  });

  it.each(['prepare', 'reservationReady'] as const)(
    'requires the exact private %s envelope and descriptor', (type) => {
      const parse = type === 'prepare' ? parseDesktopBackendCommand : parseDesktopBackendStatus;
      const reservation = {
        generationId, identity: 'a'.repeat(64), userDataRoot: resolve('synthetic-runtime'),
      };
      const message = { reservation, type };
      const parsed = parse(message);
      expect(parsed).toEqual(message);
      expect(parsed && 'reservation' in parsed && parsed.reservation).not.toBe(reservation);
      expect(parsed && 'reservation' in parsed && Object.isFrozen(parsed.reservation)).toBe(true);
      expect(parse({ ...message, granted: true })).toBeUndefined();
      expect(parse(Object.create(message))).toBeUndefined();
      expect(parse({ type })).toBeUndefined();
      for (const key of [Symbol('extra'), 'extra']) {
        const hidden = { ...message };
        Object.defineProperty(hidden, key, { value: true });
        expect(parse(hidden)).toBeUndefined();
      }
      for (const invalid of [undefined, null, {}, { ...reservation, extra: true },
        { ...reservation, generationId: generationId.toUpperCase() },
        { ...reservation, identity: 'b'.repeat(63) },
        { ...reservation, userDataRoot: '../private' }]) {
        expect(parse({ reservation: invalid, type })).toBeUndefined();
      }
      for (const key of Object.keys(reservation)) {
        const incomplete: Record<string, unknown> = { ...reservation };
        delete incomplete[key];
        expect(parse({ reservation: incomplete, type })).toBeUndefined();
      }
    },
  );

  it('requires a canonical generation on the grant, outside the unchanged config', () => {
    const config = createCompleteConfig();
    expect(parseDesktopBackendCommand({ config, type: 'start' })).toBeUndefined();
    for (const invalid of [undefined, null, 1, '', '../private', generationId.toUpperCase()]) {
      expect(parseDesktopBackendCommand({ config, generationId: invalid, type: 'start' }))
        .toBeUndefined();
    }
    expect(parseDesktopBackendCommand({
      config: { ...config, generationId }, generationId, type: 'start',
    })).toBeUndefined();
  });

  it('admits only the safe closed reservation failure code', () => {
    const status = { code: 'BACKEND_PROCESS_RESERVATION_FAILED', type: 'failed' };
    expect(parseDesktopBackendStatus(status)).toEqual(status);
    expect(parseDesktopBackendStatus({ ...status, code: `${status.code}: private` })).toBeUndefined();
    expect(parseDesktopBackendStatus({ ...status, reservation: {} })).toBeUndefined();
  });

  it('requires the exact start envelope and config fields', () => {
    const config = createCompleteConfig();
    const command = { config, generationId, type: 'start' };
    expect(parseDesktopBackendCommand(command)).toEqual(command);
    expect(parseDesktopBackendCommand({ ...command, granted: true })).toBeUndefined();
    expect(parseDesktopBackendCommand({
      ...command, config: { ...config, granted: true },
    })).toBeUndefined();
    for (const key of Object.keys(config)) {
      const incomplete = { ...config };
      delete incomplete[key];
      expect(parseDesktopBackendCommand({
        config: incomplete, generationId, type: 'start',
      }), key).toBeUndefined();
    }
  });

  it('rejects unowned keys in every existing status envelope', () => {
    const statuses = [
      { code: 'BACKEND_SERVER_START_FAILED', type: 'failed' },
      { port: 32100, smokePdfCreated: false, smokeSecretBrokerVerified: false, type: 'ready' },
      {
        inspection: {
          appliedMigrationCount: 0, pendingMigrationCount: 1,
          migrationChainIdentity: '', profileState: 'empty',
        },
        type: 'migrationGateReady',
      },
    ];
    for (const status of statuses) {
      expect(parseDesktopBackendStatus(status)).toEqual(status);
      expect(parseDesktopBackendStatus({ ...status, detail: 'not-public' }))
        .toBeUndefined();
      for (const key of Object.keys(status)) {
        const incomplete: Record<string, unknown> = { ...status };
        delete incomplete[key];
        expect(parseDesktopBackendStatus(incomplete), `${status.type}.${key}`)
          .toBeUndefined();
      }
    }
  });

  it('rejects inherited and hidden protocol additions', () => {
    const command = { config: createCompleteConfig(), generationId, type: 'start' };
    expect(parseDesktopBackendCommand(Object.create(command))).toBeUndefined();
    expect(parseDesktopBackendCommand({
      ...command, config: Object.create(command.config),
    })).toBeUndefined();
    expect(parseDesktopBackendStatus(Object.create({
      code: 'BACKEND_SERVER_START_FAILED', type: 'failed',
    }))).toBeUndefined();
    for (const key of [Symbol('extra'), 'extra']) {
      const withExtra = { ...command };
      Object.defineProperty(withExtra, key, { value: true });
      expect(parseDesktopBackendCommand(withExtra)).toBeUndefined();
    }
  });

  it('keeps ordinary shutdown exact and update shutdown operation-bound', () => {
    const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(parseDesktopBackendCommand({ type: 'shutdown' })).toEqual({
      type: 'shutdown',
    });
    expect(parseDesktopBackendCommand({ type: 'shutdown', operationId }))
      .toBeUndefined();
    expect(parseDesktopBackendCommand({ type: 'shutdownForUpdate', operationId }))
      .toEqual({ type: 'shutdownForUpdate', operationId });
    for (const invalid of [undefined, null, 1, '', '../private', 'a'.repeat(4096),
      'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa']) {
      expect(parseDesktopBackendCommand({
        type: 'shutdownForUpdate', operationId: invalid,
      })).toBeUndefined();
    }
    expect(parseDesktopBackendCommand({
      type: 'shutdownForUpdate', operationId, extra: true,
    })).toBeUndefined();
  });

  it('accepts only exact private migration gate decisions', () => {
    expect(parseDesktopBackendCommand({ type: 'continueStartup' })).toEqual({
      type: 'continueStartup',
    });
    expect(parseDesktopBackendCommand({ type: 'abortStartup' })).toEqual({
      type: 'abortStartup',
    });
    expect(
      parseDesktopBackendCommand({
        path: 'C:\\private',
        type: 'continueStartup',
      }),
    ).toBeUndefined();
  });

  it('accepts only bounded pathless migration startup inspections', () => {
    expect(
      parseDesktopBackendStatus({
        inspection: {
          appliedMigrationCount: 41,
          migrationChainIdentity: 'a'.repeat(64),
          pendingMigrationCount: 1,
          profileState: 'existing',
        },
        type: 'migrationGateReady',
      }),
    ).toEqual({
      inspection: {
        appliedMigrationCount: 41,
        migrationChainIdentity: 'a'.repeat(64),
        pendingMigrationCount: 1,
        profileState: 'existing',
      },
      type: 'migrationGateReady',
    });
    expect(
      parseDesktopBackendStatus({
        inspection: {
          appliedMigrationCount: 0,
          databaseFilePath: 'C:\\private\\profile.sqlite',
          migrationChainIdentity: '',
          pendingMigrationCount: 42,
          profileState: 'empty',
        },
        type: 'migrationGateReady',
      }),
    ).toBeUndefined();
  });

  it('accepts only absolute trusted runtime paths', () => {
    const runtimeRoot = resolve('desktop-test-runtime');

    expect(
      parseDesktopBackendCommand({
        config: createValidConfig({
          backendRoot: resolve(runtimeRoot, 'backend'),
          createSmokePdf: true,
          databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
          invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
          migrationsDirectory: resolve(
            runtimeRoot,
            'backend',
            'dist',
            'database',
            'migrations',
          ),
          operationalLogsRoot: resolve(runtimeRoot, 'logs'),
          profileSnapshotStagingRoot: resolve(
            runtimeRoot,
            'private-backup-staging',
          ),
          smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
        }),
        generationId,
        type: 'start',
      }),
    ).toBeDefined();
    expect(
      parseDesktopBackendCommand({
        config: createValidConfig({
          backendRoot: '..\\backend',
          createSmokePdf: true,
          databaseFilePath: 'eky.sqlite',
          invoiceDocumentStorageRoot: 'storage',
          migrationsDirectory: 'migrations',
          operationalLogsRoot: 'logs',
          profileSnapshotStagingRoot: 'backup-staging',
          smokePdfPath: 'invoice.pdf',
        }),
        generationId,
        type: 'start',
      }),
    ).toBeUndefined();
  });

  it('requires a valid private runtime session in the start message', () => {
    const runtimeRoot = resolve('desktop-test-runtime');
    const createCommand = (runtimeSessionSecret: unknown) => ({
      config: createValidConfig({
        backendRoot: resolve(runtimeRoot, 'backend'),
        createSmokePdf: false,
        databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
        invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
        migrationsDirectory: resolve(runtimeRoot, 'migrations'),
        operationalLogsRoot: resolve(runtimeRoot, 'logs'),
        profileSnapshotStagingRoot: resolve(
          runtimeRoot,
          'private-backup-staging',
        ),
        runtimeSessionSecret,
        smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
      }),
      generationId,
      type: 'start',
    });

    expect(parseDesktopBackendCommand(createCommand('a'.repeat(43)))).toBeDefined();
    expect(parseDesktopBackendCommand(createCommand(undefined))).toBeUndefined();
    expect(parseDesktopBackendCommand(createCommand('too-short'))).toBeUndefined();
  });

  it('keeps the runtime identity separate from the private session secret', () => {
    const runtimeRoot = resolve('desktop-test-runtime');
    const runtimeInstanceId = '11111111-1111-4111-8111-111111111111';
    const runtimeSessionSecret = 'a'.repeat(43);
    const command = parseDesktopBackendCommand({
      config: createValidConfig({
        backendRoot: resolve(runtimeRoot, 'backend'),
        databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
        invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
        migrationsDirectory: resolve(runtimeRoot, 'migrations'),
        operationalLogsRoot: resolve(runtimeRoot, 'logs'),
        profileSnapshotStagingRoot: resolve(
          runtimeRoot,
          'private-backup-staging',
        ),
        runtimeInstanceId,
        runtimeSessionSecret,
        smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
      }),
      generationId,
      type: 'start',
    });

    expect(command).toMatchObject({
      config: { runtimeInstanceId, runtimeSessionSecret },
      type: 'start',
    });
    expect(runtimeInstanceId).not.toBe(runtimeSessionSecret);
  });

  it('accepts only the closed migration startup policy values', () => {
    const runtimeRoot = resolve('desktop-test-runtime');
    const createCommand = (migrationStartupPolicy: unknown) => ({
      config: createValidConfig({
        backendRoot: resolve(runtimeRoot, 'backend'),
        databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
        invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
        migrationsDirectory: resolve(runtimeRoot, 'migrations'),
        migrationStartupPolicy,
        operationalLogsRoot: resolve(runtimeRoot, 'logs'),
        profileSnapshotStagingRoot: resolve(
          runtimeRoot,
          'private-backup-staging',
        ),
        smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
      }),
      generationId,
      type: 'start',
    });

    expect(
      parseDesktopBackendCommand(createCommand('exactCurrentManifest')),
    ).toMatchObject({
      config: { migrationStartupPolicy: 'exactCurrentManifest' },
    });
    expect(
      parseDesktopBackendCommand(createCommand('restoreCompatible')),
    ).toMatchObject({
      config: { migrationStartupPolicy: 'restoreCompatible' },
    });
    expect(
      parseDesktopBackendCommand(createCommand('allowAnyLegacyDatabase')),
    ).toBeUndefined();
    expect(parseDesktopBackendCommand(createCommand(undefined))).toBeUndefined();
  });

  it('rejects invalid or non-canonical build timestamps without throwing', () => {
    const runtimeRoot = resolve('desktop-test-runtime');
    const createCommand = (buildCreatedAt: unknown) => ({
      config: createValidConfig({
        backendRoot: resolve(runtimeRoot, 'backend'),
        buildCreatedAt,
        databaseFilePath: resolve(runtimeRoot, 'data', 'eky.sqlite'),
        invoiceDocumentStorageRoot: resolve(runtimeRoot, 'storage'),
        migrationsDirectory: resolve(runtimeRoot, 'migrations'),
        operationalLogsRoot: resolve(runtimeRoot, 'logs'),
        profileSnapshotStagingRoot: resolve(
          runtimeRoot,
          'private-backup-staging',
        ),
        smokePdfPath: resolve(runtimeRoot, 'smoke', 'invoice.pdf'),
      }),
      generationId,
      type: 'start',
    });

    expect(() =>
      parseDesktopBackendCommand(createCommand('not-a-date')),
    ).not.toThrow();
    expect(
      parseDesktopBackendCommand(createCommand('not-a-date')),
    ).toBeUndefined();
    expect(
      parseDesktopBackendCommand(createCommand('2026-07-28T03:00:00+03:00')),
    ).toBeUndefined();
    expect(
      parseDesktopBackendCommand(createCommand('2026-07-28T00:00:00Z')),
    ).toBeUndefined();
    expect(
      parseDesktopBackendCommand(createCommand('2026-02-30T00:00:00.000Z')),
    ).toBeUndefined();
  });

  it('rejects malformed readiness messages', () => {
    expect(
      parseDesktopBackendStatus({ port: 32100, smokePdfCreated: true, type: 'ready' }),
    ).toBeUndefined();
    expect(
      parseDesktopBackendStatus({
        port: 32100,
        smokePdfCreated: true,
        smokeSecretBrokerVerified: true,
        type: 'ready',
      }),
    ).toEqual({
      port: 32100,
      smokePdfCreated: true,
      smokeSecretBrokerVerified: true,
      type: 'ready',
    });
    expect(parseDesktopBackendStatus({ port: 0, type: 'ready' })).toBeUndefined();
    expect(parseDesktopBackendStatus({ error: 'sensitive details', type: 'failed' })).toBeUndefined();
  });

  it('accepts only predefined safe backend failure codes', () => {
    expect(
      parseDesktopBackendStatus({
        code: 'BACKEND_SECRET_BROKER_FAILED',
        type: 'failed',
      }),
    ).toEqual({ code: 'BACKEND_SECRET_BROKER_FAILED', type: 'failed' });
    expect(
      parseDesktopBackendStatus({
        code: 'SQLITE_ERROR: C:\\private\\eky.sqlite',
        type: 'failed',
      }),
    ).toBeUndefined();
  });
});

function createCompleteConfig(): Record<string, unknown> {
  const root = resolve('desktop-test-runtime');
  return createValidConfig({
    backendRoot: resolve(root, 'backend'),
    databaseFilePath: resolve(root, 'data', 'eky.sqlite'),
    invoiceDocumentStorageRoot: resolve(root, 'storage'),
    migrationsDirectory: resolve(root, 'migrations'),
    operationalLogsRoot: resolve(root, 'logs'),
    profileSnapshotStagingRoot: resolve(root, 'staging'),
    smokePdfPath: resolve(root, 'smoke', 'invoice.pdf'),
  });
}

function createValidConfig(
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  return {
    appVersion: '0.1.0-alpha.1',
    architecture: 'x64',
    buildCreatedAt: '2026-07-28T00:00:00.000Z',
    buildDirty: false,
    buildRevision: '123456789abc',
    createSmokePdf: false,
    electronVersion: '42.6.1',
    migrationStartupPolicy: 'exactCurrentManifest',
    platform: 'win32',
    runtimeInstanceId: '11111111-1111-4111-8111-111111111111',
    runtimeSessionSecret: 'a'.repeat(43),
    verifySmokeSecretBroker: false,
    ...overrides,
  };
}
