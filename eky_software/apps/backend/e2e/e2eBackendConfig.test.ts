import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyE2eBackendRuntimePathOverrides,
  type E2eBackendConfig,
} from './e2eBackendConfig.js';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('E2E backend runtime path overrides', () => {
  it('accepts active workspace paths inside the isolated runtime root', () => {
    const fixture = createFixture();
    const workspaceRoot = createDirectory(
      fixture.runtimeRoot,
      'desktop-user-data',
      'workspaces',
      'workspace-test',
    );
    const databaseRoot = createDirectory(workspaceRoot, 'runtime', 'data');
    const documentsRoot = createDirectory(
      workspaceRoot,
      'runtime',
      'storage',
      'invoices',
    );
    const logsRoot = createDirectory(
      fixture.runtimeRoot,
      'desktop-user-data',
      'runtime',
      'logs',
    );

    const overridden = applyE2eBackendRuntimePathOverrides(
      fixture.config,
      fixture.configPath,
      {
        databaseFilePath: join(databaseRoot, 'eky.sqlite'),
        documentsRoot,
        logsRoot,
      },
      fixture.environment,
    );

    expect(overridden.paths).toMatchObject({
      databaseFilePath: join(databaseRoot, 'eky.sqlite'),
      documentsRoot,
      logsRoot,
    });
    expect(fixture.config.paths.databaseFilePath).toBe(
      fixture.originalDatabaseFilePath,
    );
  });

  it('rejects an override that escapes the isolated runtime root', () => {
    const fixture = createFixture();
    const outsideRoot = createSiblingTestRoot('backend-config-outside-');
    const documentsRoot = createDirectory(outsideRoot, 'documents');

    expect(() =>
      applyE2eBackendRuntimePathOverrides(
        fixture.config,
        fixture.configPath,
        {
          databaseFilePath: fixture.config.paths.databaseFilePath,
          documentsRoot,
          logsRoot: fixture.config.paths.logsRoot,
        },
        fixture.environment,
      ),
    ).toThrow('E2E runtime path escapes its allowed root.');
  });

  it('rejects an override whose required directory does not exist', () => {
    const fixture = createFixture();

    expect(() =>
      applyE2eBackendRuntimePathOverrides(
        fixture.config,
        fixture.configPath,
        {
          databaseFilePath: fixture.config.paths.databaseFilePath,
          documentsRoot: join(fixture.runtimeRoot, 'missing-documents'),
          logsRoot: fixture.config.paths.logsRoot,
        },
        fixture.environment,
      ),
    ).toThrow();
  });
});

function createFixture(): {
  config: E2eBackendConfig;
  configPath: string;
  environment: Readonly<Record<string, string>>;
  originalDatabaseFilePath: string;
  runtimeRoot: string;
} {
  const runtimeRoot = createSiblingTestRoot('backend-config-');
  const databaseRoot = createDirectory(runtimeRoot, 'backend', 'data');
  const configPath = join(runtimeRoot, 'backend-config.json');
  writeFileSync(configPath, '{}', { encoding: 'utf8', mode: 0o600 });

  const config: E2eBackendConfig = {
    backend: {
      host: '127.0.0.1',
      port: 3_001,
      sessionSecret: 'A'.repeat(43),
    },
    faultPlan: { kind: 'none' },
    formatVersion: 1,
    marker: 'EKY_E2E',
    paths: {
      artifactsRoot: createDirectory(runtimeRoot, 'artifacts'),
      databaseFilePath: join(databaseRoot, 'eky.sqlite'),
      documentsRoot: createDirectory(runtimeRoot, 'backend', 'documents'),
      incidentsRoot: createDirectory(runtimeRoot, 'backend', 'incidents'),
      logsRoot: createDirectory(runtimeRoot, 'backend', 'logs'),
      supportBundlesRoot: createDirectory(
        runtimeRoot,
        'backend',
        'support-bundles',
      ),
      tempRoot: createDirectory(runtimeRoot, 'backend', 'temp'),
    },
    runtimeRoot,
    scenarioId: 'W4-RUNTIME-PATHS',
    smtpAdapter: 'fake',
  };

  return {
    config,
    configPath,
    environment: {
      EKY_E2E: '1',
      EKY_ELECTRON_E2E_RUN_ROOT: runtimeRoot,
    },
    originalDatabaseFilePath: config.paths.databaseFilePath,
    runtimeRoot,
  };
}

function createSiblingTestRoot(prefix: string): string {
  const parent = join(tmpdir(), 'eky-e2e');
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, prefix));
  testRoots.push(root);
  return root;
}

function createDirectory(root: string, ...segments: string[]): string {
  const path = join(root, ...segments);
  mkdirSync(path, { recursive: true });
  return path;
}
