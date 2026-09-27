import { mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { readE2eViteRuntimeConfig } from '../../../web/viteE2eRuntime.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';

test.describe('WEB-VITE-TEMP-001 @critical @security', () => {
  test('owned Vite retains the OS anchor with writable temp inside the same run', () => {
    const f = fixture();
    try {
      expect(readE2eViteRuntimeConfig(f.environment)).toMatchObject({
        backendOrigin: 'http://127.0.0.1:34567', environmentDirectory: f.paths.tempRoot,
        cacheDirectory: join(f.paths.tempRoot, 'vite-cache'),
      });
    } finally { f.dispose(); }
  });

  for (const key of ['TEMP', 'TMP'] as const) {
    for (const invalid of ['missing', 'relative', 'host', 'sibling'] as const) {
      test(`owned Vite rejects ${key} ${invalid}`, () => {
        const f = fixture();
        try {
          const value = { missing: undefined, relative: 'relative-temp', host: f.hostTemp,
            sibling: f.siblingTemp }[invalid];
          expect(() => readE2eViteRuntimeConfig({ ...f.environment, [key]: value })).toThrow();
        } finally { f.dispose(); }
      });
    }
  }

  test('an anchor without the E2E marker is not a normal development configuration', () => {
    expect(() => readE2eViteRuntimeConfig({ EKY_E2E_OS_TEMP_ROOT: tmpdir() })).toThrow('marker');
    expect(readE2eViteRuntimeConfig({})).toBeNull();
  });

  test('relative and mismatched OS anchors fail closed', () => {
    const f = fixture();
    try {
      for (const anchor of ['relative', f.temp]) {
        expect(() => readE2eViteRuntimeConfig({ ...f.environment, EKY_E2E_OS_TEMP_ROOT: anchor })).toThrow();
      }
    } finally { f.dispose(); }
  });

  test('an original linked parent cannot disappear through canonicalization', () => {
    const f = fixture();
    try {
      const link = join(f.runRoot, 'linked-worker');
      symlinkSync(f.paths.workerRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
      expect(() => readE2eViteRuntimeConfig({ ...f.environment,
        EKY_E2E_ENV_ROOT: join(link, 'temp') })).toThrow('without links');
    } finally { f.dispose(); }
  });

  test('direct development tests without an owner keep their original OS-temp boundary', () => {
    const f = fixture();
    try {
      const { EKY_E2E_OS_TEMP_ROOT: _anchor, TEMP: _temp, TMP: _tmp, ...direct } = f.environment;
      expect(readE2eViteRuntimeConfig(direct)?.environmentDirectory).toBe(f.paths.tempRoot);
    } finally { f.dispose(); }
  });
});

function fixture() {
  const runRoot = createE2eRunRoot();
  const siblingRoot = createE2eRunRoot();
  const paths = createE2eWorkerPaths(runRoot, 'WEB-VITE-TEMP-001');
  const temp = join(runRoot, 'owner-temp');
  const siblingTemp = join(siblingRoot, 'owner-temp');
  mkdirSync(temp);
  mkdirSync(siblingTemp);
  const hostTemp = realpathSync.native(tmpdir());
  return { runRoot, paths, temp, siblingTemp, hostTemp,
    environment: {
      EKY_E2E: '1', EKY_E2E_BACKEND_ORIGIN: 'http://127.0.0.1:34567',
      EKY_E2E_ENV_ROOT: paths.tempRoot, EKY_E2E_RUNTIME_SESSION: 'a'.repeat(43),
      EKY_E2E_OS_TEMP_ROOT: hostTemp, TEMP: temp, TMP: temp,
    },
    dispose() {
      // These tests never launch a workload; both roots contain synthetic files only.
      rmSync(runRoot, { recursive: true, force: true });
      rmSync(siblingRoot, { recursive: true, force: true });
    },
  };
}
