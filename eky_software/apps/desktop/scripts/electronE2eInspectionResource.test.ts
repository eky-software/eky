import * as fileSystem from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { profileInspectionNativeContract as contract } from '../../backend/src/database/connection/profileInspectionNativeContract.js';
import { createElectronE2eRuntime } from '../../e2e/src/environment/createElectronE2eRuntime.js';
import type { E2eWorkerPaths } from '../../e2e/src/environment/e2eEnvironmentTypes.js';

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, cpSync: vi.fn(actual.cpSync) };
});

const roots: string[] = [];
const repositoryRoot = resolve(import.meta.dirname, '../../..');
afterEach(async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(fileSystem.cpSync).mockReset().mockImplementation(actual.cpSync);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = fileSystem.realpathSync.native(await mkdtemp(join(tmpdir(), 'eky-e2e-inspection-resource-')));
  roots.push(root);
  const emptyDirectory = join(root, 'empty-build-directory');
  const emptyFile = join(root, 'empty-build-file.js');
  const nativeStage = join(root, 'native-stage');
  const runtimeStage = join(root, 'runtime-stage');
  await mkdir(emptyDirectory);
  await mkdir(nativeStage);
  await mkdir(runtimeStage);
  await writeFile(emptyFile, 'export {};\n');
  for (const name of ['profileInspectionRunner', 'profileInspectionMessages', 'workspaceProcessReservation']) {
    await writeFile(join(runtimeStage, `${name}.js`), `export const fixture = '${name}';\n`);
  }
  // This tests byte isolation, not native loading or metadata attestation.
  const bytes = Buffer.alloc(contract.minimumNativeBytes, 1);
  await writeFile(join(nativeStage, contract.fileName), bytes);
  await writeFile(join(nativeStage, contract.metadataFileName), JSON.stringify({ purpose: contract.purpose }));
  const sourceMap = new Map([
    ['apps/desktop/dist/preload', emptyDirectory],
    ['apps/desktop/dist/profileBackup/passwordWindow/backupPasswordPreload.cjs', emptyFile],
    ['apps/web/dist', emptyDirectory],
    ['apps/desktop/e2e-backend-stage', emptyDirectory],
    ['apps/desktop/e2e-inspection-native-stage', nativeStage],
    ['apps/desktop/dist/runtime', runtimeStage],
    ...['secrets', 'invoicePdfArchive'].map(name => [`apps/desktop/dist/${name}`, emptyDirectory]),
    ...['electronProfileSnapshotBrokerTransport', 'profileSnapshotBrokerBackend',
      'profileSnapshotBrokerProtocol', 'profileSnapshotBrokerTransport']
      .map(name => [`apps/desktop/dist/profileBackup/${name}.js`, emptyFile]),
  ].map(([source, target]) => [resolve(repositoryRoot, source!), target!]));
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  vi.mocked(fileSystem.cpSync).mockImplementation((source, target, options) => {
    if (typeof source !== 'string' || !sourceMap.has(source)) throw new Error('Unexpected build source.');
    actual.cpSync(sourceMap.get(source)!, target, options);
  });
  function paths(name: string): E2eWorkerPaths {
    const workerRoot = join(root, name);
    fileSystem.mkdirSync(workerRoot);
    const directory = (value: string) => {
      const path = join(workerRoot, value);
      fileSystem.mkdirSync(path);
      return path;
    };
    return {
      workerRoot, artifactsRoot: directory('artifacts'), documentsRoot: directory('documents'),
      incidentsRoot: directory('incidents'), logsRoot: directory('logs'),
      supportBundlesRoot: directory('support'), tempRoot: directory('temp'),
      databaseFilePath: join(workerRoot, 'database.sqlite'),
      runtimeConfigPath: join(workerRoot, 'runtime.json'),
    };
  }
  return { bytes, nativeStage, runtimeStage, paths };
}

describe('Electron E2E inspection resource isolation', () => {
  it('copies both inspection files into each actual runtime without shared file identity', async () => {
    const f = await fixture();
    const firstPaths = f.paths('first');
    const secondPaths = f.paths('second');
    createElectronE2eRuntime({ backendPort: 12345, paths: firstPaths, scenarioId: 'inspection-copy-first' });
    createElectronE2eRuntime({ backendPort: 12346, paths: secondPaths, scenarioId: 'inspection-copy-second' });
    const first = join(firstPaths.workerRoot, 'desktop-resources', contract.directoryName);
    const second = join(secondPaths.workerRoot, 'desktop-resources', contract.directoryName);
    for (const name of [contract.fileName, contract.metadataFileName]) {
      const original = fileSystem.readFileSync(join(f.nativeStage, name));
      expect(fileSystem.readFileSync(join(first, name))).toEqual(original);
      expect(fileSystem.readFileSync(join(second, name))).toEqual(original);
      for (const directory of [first, second, f.nativeStage]) {
        expect(fileSystem.lstatSync(join(directory, name)).nlink).toBe(1);
      }
    }
    expect(fileSystem.readdirSync(first).sort()).toEqual([contract.fileName, contract.metadataFileName].sort());
    fileSystem.writeFileSync(join(first, contract.fileName), Buffer.alloc(f.bytes.length, 2));
    expect(fileSystem.readFileSync(join(f.nativeStage, contract.fileName))).toEqual(f.bytes);
    expect(fileSystem.readFileSync(join(second, contract.fileName))).toEqual(f.bytes);
  });

  it('rejects a missing prepared inspection stage before publishing runtime configuration', async () => {
    const f = await fixture();
    const paths = f.paths('missing');
    await rm(f.nativeStage, { recursive: true });
    expect(() => createElectronE2eRuntime({ backendPort: 12345, paths, scenarioId: 'inspection-copy-missing' }))
      .toThrow();
    expect(fileSystem.existsSync(join(paths.workerRoot, 'electron-config.json'))).toBe(false);
    expect(fileSystem.existsSync(paths.runtimeConfigPath)).toBe(false);
  });

  it('delivers the inspector and its runtime imports at the actual main-owned application path', async () => {
    const f = await fixture();
    const paths = f.paths('runner');
    const runtime = createElectronE2eRuntime({ backendPort: 12345, paths, scenarioId: 'inspection-runner-path' });
    const config = JSON.parse(fileSystem.readFileSync(runtime.configPath, 'utf8')) as {
      paths: { applicationPath: string; resourcesPath: string };
    };
    for (const name of ['profileInspectionRunner', 'profileInspectionMessages', 'workspaceProcessReservation']) {
      const source = join(f.runtimeStage, `${name}.js`);
      const applicationFile = join(config.paths.applicationPath, 'dist', 'runtime', `${name}.js`);
      const backendFile = join(config.paths.resourcesPath, 'desktop-runtime', 'runtime', `${name}.js`);
      const original = fileSystem.readFileSync(source);
      expect(fileSystem.readFileSync(applicationFile)).toEqual(original);
      expect(fileSystem.readFileSync(backendFile)).toEqual(original);
      for (const path of [source, applicationFile, backendFile]) expect(fileSystem.lstatSync(path).nlink).toBe(1);
      fileSystem.writeFileSync(applicationFile, 'export const changed = true;\n');
      expect(fileSystem.readFileSync(source)).toEqual(original);
      expect(fileSystem.readFileSync(backendFile)).toEqual(original);
    }
  });

  it('rejects a missing application runtime build before publishing configuration', async () => {
    const f = await fixture();
    const paths = f.paths('missing-runner');
    await rm(f.runtimeStage, { recursive: true });
    expect(() => createElectronE2eRuntime({ backendPort: 12345, paths, scenarioId: 'inspection-runner-missing' }))
      .toThrow();
    expect(fileSystem.existsSync(join(paths.workerRoot, 'electron-config.json'))).toBe(false);
    expect(fileSystem.existsSync(paths.runtimeConfigPath)).toBe(false);
  });
});
