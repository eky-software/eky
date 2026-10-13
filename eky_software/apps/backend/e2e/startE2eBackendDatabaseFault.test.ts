import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as connections from '../src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../src/database/migration/runMigrations.js';
import { readE2eBackendConfig, type E2eBackendConfig } from './e2eBackendConfig.js';
import * as databaseFault from './installE2eDatabaseFault.js';
import { startE2eBackend } from './startE2eBackend.js';

vi.mock('./e2eBackendConfig.js', () => ({ readE2eBackendConfig: vi.fn() }));

const roots: string[] = [];
const databases: connections.DatabaseConnection[] = [];
afterEach(context => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  const owned = roots.splice(0);
  for (const database of databases.splice(0)) if (database.open) database.close();
  if (context.task.result?.state !== 'pass') return;
  for (const root of owned) rmSync(root, { recursive: true, force: true });
});

describe('E2E database fault startup admission', () => {
  it('admits the real schema before installing the named write fault', async () => {
    const config = fixture();
    const { server } = await startE2eBackend(join(config.runtimeRoot, 'config.json'));
    try {
      const response = await fetch(`http://${server.hostname}:${server.port}/health`);
      expect(response.status).toBe(200);
      const database = connections.createDatabaseConnection({ databaseFilePath: config.paths.databaseFilePath, fileMustExist: true });
      try {
        expect(() => database.prepare('INSERT INTO company_settings (company_id) VALUES (?)').run('synthetic-company'))
          .toThrow('E2E_DATABASE_WRITE_FAILED');
        expect(database.prepare('SELECT count(*) AS count FROM company_settings').get()).toEqual({ count: 0 });
      } finally { database.close(); }
    } finally { await server.close(); }
  });

  it('does not let a fault plan admit an unsupported existing schema', async () => {
    const config = fixture();
    const database = connections.createDatabaseConnection({ databaseFilePath: config.paths.databaseFilePath });
    try {
      await runMigrations(database);
      database.exec('CREATE TABLE unexpected_object (value TEXT)');
    } finally { database.close(); }
    const before = readFileSync(config.paths.databaseFilePath);
    const install = vi.spyOn(databaseFault, 'installE2eDatabaseFault');
    await expect(startE2eBackend(join(config.runtimeRoot, 'config.json'))).rejects.toThrow();
    expect(install).not.toHaveBeenCalled();
    expect(readFileSync(config.paths.databaseFilePath)).toEqual(before);
  });
});

function fixture(): E2eBackendConfig {
  const open = connections.createDatabaseConnection;
  vi.spyOn(connections, 'createDatabaseConnection').mockImplementation(options => {
    const database = open(options);
    databases.push(database);
    return database;
  });
  const root = mkdtempSync(join(tmpdir(), 'eky-fault-admission-'));
  roots.push(root);
  const config: E2eBackendConfig = {
    formatVersion: 1, marker: 'EKY_E2E', scenarioId: 'SYS-FAULT-ADMISSION-001',
    runtimeRoot: root, smtpAdapter: 'fake',
    faultPlan: { kind: 'databaseWriteFailed', operation: 'updateCompanySettings', failOnCall: 1 },
    backend: { host: '127.0.0.1', port: 0, sessionSecret: 's'.repeat(43) },
    paths: {
      artifactsRoot: join(root, 'artifacts'), databaseFilePath: join(root, 'database.sqlite'),
      documentsRoot: join(root, 'documents'), incidentsRoot: join(root, 'incidents'),
      logsRoot: join(root, 'logs'), supportBundlesRoot: join(root, 'support'), tempRoot: join(root, 'temp'),
    },
  };
  vi.mocked(readE2eBackendConfig).mockReturnValue(config);
  return config;
}
