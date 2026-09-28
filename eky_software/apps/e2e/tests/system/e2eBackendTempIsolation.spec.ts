import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { expect, test } from '@playwright/test';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { writeE2eBackendConfig } from '../../src/environment/writeE2eBackendConfig.js';

test('backend config keeps its original run boundary when child OS temp is isolated', async () => {
  const hostTempRoot = realpathSync.native(tmpdir());
  const runRoot = createE2eRunRoot();
  const siblingRoot = createE2eRunRoot();
  const paths = createE2eWorkerPaths(runRoot, 'SYS-TEMP-ANCHOR');
  const sibling = createE2eWorkerPaths(siblingRoot, 'SYS-TEMP-SIBLING');
  writeE2eBackendConfig({ backendPort: 43123, paths, scenarioId: 'SYS-TEMP-ANCHOR' });
  const reader = new URL('../../../backend/e2e-dist/e2e/e2eBackendConfig.js', import.meta.url).href;
  // Read only the synthetic config in a real child so os.tmpdir() observes the
  // isolated environment. No backend, database or network listener is started.
  const source = `import { readE2eBackendConfig } from ${JSON.stringify(reader)};
try { readE2eBackendConfig(${JSON.stringify(paths.runtimeConfigPath)}); console.log('accepted'); }
catch (error) { console.log(error.code === 'ENOENT' ? 'anchorMissing' : 'rejected'); process.exitCode = 1; }`;
  const environment = { EKY_E2E: '1', NODE_ENV: 'test',
    TEMP: paths.tempRoot, TMP: paths.tempRoot, TMPDIR: paths.tempRoot };
  let completed = false;
  try {
    for (const [extra, expected] of [
      [{}, 'anchorMissing'],
      [{ EKY_E2E_OS_TEMP_ROOT: hostTempRoot }, 'accepted'],
      [{ EKY_E2E_OS_TEMP_ROOT: hostTempRoot, TEMP: sibling.tempRoot }, 'rejected'],
      [{ EKY_E2E_OS_TEMP_ROOT: hostTempRoot, TMP: sibling.tempRoot }, 'rejected'],
    ] as const) {
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
        env: { ...environment, ...extra }, encoding: 'utf8', timeout: 5000,
        maxBuffer: 65536, windowsHide: true,
      });
      expect(result.error).toBeUndefined();
      expect(result.signal).toBeNull();
      expect(result.stderr).toBe('');
      expect(result.status).toBe(expected === 'accepted' ? 0 : 1);
      expect(result.stdout.trim()).toBe(expected);
    }
    completed = true;
  } finally {
    if (completed) {
      await removeE2eRunRoot(siblingRoot);
      await removeE2eRunRoot(runRoot);
    }
  }
});
