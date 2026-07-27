import { describe, expect, it, vi } from 'vitest';

import { getRuntimeDiagnosticSummary } from './getRuntimeDiagnosticSummary.js';

describe('getRuntimeDiagnosticSummary', () => {
  it('combines only safe runtime, database and log summaries', async () => {
    const result = await getRuntimeDiagnosticSummary(
      {
        actorContext: {
          actorId: 'actor-1',
          authenticationMode: 'local',
          companyId: 'company-1',
          permissions: ['viewDiagnostics'],
        },
      },
      {
        identity: createIdentity(),
        operationalLogSummaryReader: {
          async readOperationalLogSummary() {
            return {
              latestErrorAt: '2026-07-28T12:00:00.000Z',
              latestSecurityEventAt: null,
              latestWarningAt: null,
              operationalLogNewestMonth: '2026-07',
              operationalLogOldestMonth: '2026-07',
              operationalLogsAvailable: true,
              operationalLogTotalBytes: 1_024,
            };
          },
        },
        systemDiagnosticSummaryReader: {
          async readDatabaseSummary() {
            return {
              appliedMigrationCount: 42,
              health: 'ok',
              latestMigrationName: '042_example.sql',
            };
          },
        },
      },
    );

    expect(result).toMatchObject({
      appVersion: '0.1.0-alpha.1',
      appliedMigrationCount: 42,
      databaseHealth: 'ok',
      operationalLogsAvailable: true,
    });
    expect(result).not.toHaveProperty('databaseFilePath');
    expect(result).not.toHaveProperty('logsRoot');
    expect(result).not.toHaveProperty('runtimeSessionSecret');
    expect(result).not.toHaveProperty('companyId');
  });

  it('denies access before reading infrastructure summaries', async () => {
    const readDatabaseSummary = vi.fn();
    const readOperationalLogSummary = vi.fn();

    await expect(
      getRuntimeDiagnosticSummary(
        {
          actorContext: {
            actorId: 'actor-1',
            authenticationMode: 'local',
            companyId: 'company-1',
            permissions: [],
          },
        },
        {
          identity: createIdentity(),
          operationalLogSummaryReader: { readOperationalLogSummary },
          systemDiagnosticSummaryReader: { readDatabaseSummary },
        },
      ),
    ).rejects.toThrow('Permission denied.');
    expect(readDatabaseSummary).not.toHaveBeenCalled();
    expect(readOperationalLogSummary).not.toHaveBeenCalled();
  });

  it('returns bounded unavailable states when local sources cannot be read', async () => {
    const result = await getRuntimeDiagnosticSummary(
      {
        actorContext: {
          actorId: 'actor-1',
          authenticationMode: 'local',
          companyId: 'company-1',
          permissions: ['viewDiagnostics'],
        },
      },
      {
        identity: createIdentity(),
        operationalLogSummaryReader: {
          async readOperationalLogSummary() {
            throw new Error('/private/log/path');
          },
        },
        systemDiagnosticSummaryReader: {
          async readDatabaseSummary() {
            throw new Error('/private/database/path');
          },
        },
      },
    );

    expect(result).toMatchObject({
      appliedMigrationCount: null,
      databaseHealth: 'failed',
      latestMigrationName: null,
      operationalLogsAvailable: false,
      operationalLogTotalBytes: 0,
    });
  });
});

function createIdentity() {
  return {
    appVersion: '0.1.0-alpha.1',
    architecture: 'x64',
    buildCreatedAt: '2026-07-28T12:00:00.000Z',
    buildDirty: false,
    buildRevision: 'abcdef123456',
    electronVersion: '42.7.0',
    nodeVersion: 'v24.11.0',
    platform: 'win32',
    runtimeInstanceId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
  };
}
