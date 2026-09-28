import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { startServer } from '../src/http/server.js';
import { createBackendOperationalEvent } from '../src/observability/createOperationalEvent.js';
import { readE2eBackendConfig, type E2eBackendConfig } from './e2eBackendConfig.js';
import { startE2eBackend } from './startE2eBackend.js';

vi.mock('../src/http/server.js', () => ({ startServer: vi.fn() }));
vi.mock('./e2eBackendConfig.js', () => ({ readE2eBackendConfig: vi.fn() }));
vi.mock('./installE2eDatabaseFault.js', () => ({ installE2eDatabaseFault: vi.fn() }));

const roots: string[] = [];
afterEach(() => {
  vi.resetAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('E2E backend startup logger wiring', () => {
  for (const mode of ['absent', 'collect', 'throws'] as const) {
    it(`passes the real logger to server startup with observer ${mode}`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'eky-startup-log-wiring-'));
      roots.push(root);
      const config: E2eBackendConfig = {
        formatVersion: 1, marker: 'EKY_E2E', scenarioId: 'SYS-STARTUP-LOG-001',
        runtimeRoot: root, smtpAdapter: 'fake', faultPlan: { kind: 'none' },
        backend: { host: '127.0.0.1', port: 0, sessionSecret: 's'.repeat(43) },
        paths: {
          artifactsRoot: join(root, 'artifacts'), databaseFilePath: join(root, 'database.sqlite'),
          documentsRoot: join(root, 'documents'), incidentsRoot: join(root, 'incidents'),
          logsRoot: join(root, 'logs'), supportBundlesRoot: join(root, 'support'),
          tempRoot: join(root, 'temp'),
        },
      };
      vi.mocked(readE2eBackendConfig).mockReturnValue(config);
      const server = { close: vi.fn(async () => {}), hostname: '127.0.0.1', port: 0 };
      const observer = vi.fn((_stage: string) => {
        if (mode === 'throws') throw new Error('synthetic observer failure');
      });
      vi.mocked(startServer).mockImplementation(async (options) => {
        const logger = options?.appOptions?.operationalLogger;
        const identity = options?.appOptions?.operationalIdentity;
        expect(logger).toBeDefined();
        expect(identity).toBeDefined();
        logger!.write(createBackendOperationalEvent({ eventName: 'migration.started' }, identity!));
        logger!.write(createBackendOperationalEvent({ eventName: 'migration.completed' }, identity!));
        logger!.write(createBackendOperationalEvent({
          eventName: 'migration.failed', completedMigrationCount: 0,
          errorCode: 'SYNTHETIC_MIGRATION_FAILED', failureStage: 'unknown', sideEffectState: 'unknown',
        }, identity!));
        return server;
      });

      const result = await startE2eBackend(join(root, 'config.json'),
        mode === 'absent' ? {} : { observeStartupLog: observer });
      expect(result.server).toBe(server);
      expect(startServer).toHaveBeenCalledTimes(1);
      expect(observer.mock.calls).toEqual(mode === 'absent' ? [] : [
        ['migration.started.log.entered'], ['migration.started.log.returned'],
        ['migration.completed.log.entered'], ['migration.completed.log.returned'],
        ['migration.failed.log.entered'], ['migration.failed.log.returned'],
      ]);

      const directory = join(config.paths.logsRoot, 'backend');
      const recordedNames = readdirSync(directory).flatMap((name) =>
        readFileSync(join(directory, name), 'utf8').trim().split('\n')
          .map((line) => (JSON.parse(line) as { eventName: string }).eventName));
      expect(recordedNames.sort()).toEqual([
        'migration.completed', 'migration.failed', 'migration.started',
      ]);
    });
  }
});
