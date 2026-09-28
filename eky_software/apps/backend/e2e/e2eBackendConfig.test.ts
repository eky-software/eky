import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep, win32 } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyE2eBackendRuntimePathOverrides,
  readE2eBackendConfig,
  type E2eBackendConfig,
} from './e2eBackendConfig.js';

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('E2E backend runtime path overrides', () => {
  it('keeps data and isolated process temp under the same native run root', () => {
    const fixture = createFixture('run-');
    const temp = createDirectory(fixture.runtimeRoot, 'control', 'temp');
    writeFileSync(fixture.configPath, JSON.stringify(fixture.config));
    const environment = {
      EKY_E2E: '1', EKY_E2E_OS_TEMP_ROOT: realpathSync.native(tmpdir()), TEMP: temp, TMP: temp,
    };
    expect(readE2eBackendConfig(fixture.configPath, environment)).toEqual(fixture.config);
    for (const key of ['TEMP', 'TMP'] as const) {
      for (const value of [undefined, tmpdir(), createSiblingTestRoot('run-'), 'relative-temp']) {
        expect(() => readE2eBackendConfig(fixture.configPath, { ...environment, [key]: value })).toThrow();
      }
    }
    expect(() => readE2eBackendConfig(fixture.configPath, {
      ...environment, EKY_ELECTRON_E2E_RUN_ROOT: fixture.runtimeRoot,
    })).toThrow('policies conflict');
    expect(() => readE2eBackendConfig(fixture.configPath, {
      ...environment, EKY_E2E_OS_TEMP_ROOT: 'relative-root',
    })).toThrow('E2E backend host temp root is invalid.');
  });

  it('does not turn an explicit temp anchor into an arbitrary runtime-root override', () => {
    const fixture = createFixture();
    writeFileSync(fixture.configPath, JSON.stringify(fixture.config));
    expect(() => readE2eBackendConfig(fixture.configPath, {
      EKY_E2E: '1', EKY_E2E_OS_TEMP_ROOT: realpathSync.native(tmpdir()),
      TEMP: fixture.config.paths.tempRoot, TMP: fixture.config.paths.tempRoot,
    })).toThrow('isolated run root');
  });

  it('accepts native-canonical standalone paths under the isolated temp root', () => {
    const fixture = createFixture();
    writeFileSync(
      fixture.configPath,
      `${JSON.stringify(fixture.config)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );

    const parsed = readE2eBackendConfig(fixture.configPath, {
      EKY_E2E: '1',
    });

    expect(parsed.runtimeRoot).toBe(fixture.runtimeRoot);
    expect(parsed.paths.databaseFilePath).toBe(
      fixture.originalDatabaseFilePath,
    );
  });

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

  it.skipIf(process.platform !== 'win32')('rejects another drive before reading its directories', () => {
    const fixture = createFixture();
    const otherDrive = win32.parse(fixture.runtimeRoot).root.toUpperCase() === 'C:\\' ? 'D:\\' : 'C:\\';
    expect(() => applyE2eBackendRuntimePathOverrides(
      fixture.config,
      fixture.configPath,
      {
        databaseFilePath: fixture.config.paths.databaseFilePath,
        documentsRoot: win32.join(otherDrive, 'eky-e2e', 'run-outside', 'documents'),
        logsRoot: fixture.config.paths.logsRoot,
      },
      fixture.environment,
    )).toThrow('E2E runtime path escapes its allowed root.');
  });

  it.each(['nested', 'parentTraversal'])('rejects an original directory link before realpath: %s', (kind) => {
    const fixture = createFixture();
    const alias = join(fixture.runtimeRoot, 'backend-alias');
    symlinkSync(join(fixture.runtimeRoot, 'backend'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    const documentsRoot = kind === 'nested' ? join(alias, 'documents')
      : `${alias}${sep}..${sep}backend${sep}documents`;
    expect(() => applyE2eBackendRuntimePathOverrides(
      fixture.config,
      fixture.configPath,
      {
        databaseFilePath: fixture.config.paths.databaseFilePath,
        documentsRoot,
        logsRoot: fixture.config.paths.logsRoot,
      },
      fixture.environment,
    )).toThrow('E2E runtime path must not contain symbolic links.');
  });

  it.each(['TEMP', 'TMP'])('rejects an original directory link in isolated %s', (key) => {
    const fixture = createFixture('run-');
    const temp = createDirectory(fixture.runtimeRoot, 'control', 'temp');
    const alias = join(fixture.runtimeRoot, 'control-alias');
    symlinkSync(join(fixture.runtimeRoot, 'control'), alias, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(fixture.configPath, JSON.stringify(fixture.config));
    expect(() => readE2eBackendConfig(fixture.configPath, {
      EKY_E2E: '1', EKY_E2E_OS_TEMP_ROOT: realpathSync.native(tmpdir()),
      TEMP: temp, TMP: temp, [key]: join(alias, 'temp'),
    })).toThrow('E2E runtime path must not contain symbolic links.');
  });

  it('rejects an original directory link in the config file path', () => {
    const fixture = createFixture();
    const configRoot = createDirectory(fixture.runtimeRoot, 'config-source');
    const alias = join(fixture.runtimeRoot, 'config-alias');
    symlinkSync(configRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
    writeFileSync(join(configRoot, 'backend-config.json'), JSON.stringify(fixture.config));
    expect(() => readE2eBackendConfig(join(alias, 'backend-config.json'), fixture.environment))
      .toThrow('E2E runtime path must not contain symbolic links.');
  });
});

function createFixture(prefix = 'backend-config-'): {
  config: E2eBackendConfig;
  configPath: string;
  environment: Readonly<Record<string, string>>;
  originalDatabaseFilePath: string;
  runtimeRoot: string;
} {
  const runtimeRoot = createSiblingTestRoot(prefix);
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
  const root = realpathSync.native(mkdtempSync(join(parent, prefix)));
  testRoots.push(root);
  return root;
}

function createDirectory(root: string, ...segments: string[]): string {
  const path = join(root, ...segments);
  mkdirSync(path, { recursive: true });
  return path;
}
