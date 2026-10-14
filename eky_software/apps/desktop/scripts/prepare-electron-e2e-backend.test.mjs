import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { prepareElectronE2eBackend } from './prepare-electron-e2e-backend.mjs';

const phases = ['build', 'deploy', 'runtime', 'database', 'native'];

async function fixture(context, failure) {
  const root = await mkdtemp(join(tmpdir(), 'eky-electron-preparation-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const backendStage = join(root, 'apps/desktop/e2e-backend-stage');
  const nativeStage = join(root, 'apps/desktop/e2e-inspection-native-stage');
  const buildRoot = join(root, '.eky-local/profile-inspection-native-builds/e2e');
  const e2eDist = join(root, 'apps/backend/e2e-dist');
  for (const directory of [backendStage, nativeStage, buildRoot, e2eDist]) {
    await mkdir(directory, { recursive: true });
  }
  await writeFile(join(backendStage, 'stale-backend.txt'), 'old backend');
  await writeFile(join(nativeStage, 'stale-native.txt'), 'old native');
  await writeFile(join(buildRoot, 'retained-evidence.txt'), 'retained evidence');
  await writeFile(join(e2eDist, 'entry.js'), 'export {};\n');
  const calls = [];
  async function enter(phase) {
    calls.push(phase);
    await assert.rejects(readFile(join(backendStage, 'stale-backend.txt')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(nativeStage, 'stale-native.txt')), { code: 'ENOENT' });
    if (phase === failure) throw new Error(`synthetic-${phase}-failure`);
  }
  const input = {
    root,
    async runPnpmCommand(args) {
      if (args[2] === 'build') {
        assert.deepEqual(args, ['--filter', '@eky/backend', 'build']);
        await enter('build');
      } else {
        assert.deepEqual(args, ['--filter', '@eky/backend', 'deploy', '--prod', backendStage]);
        await enter('deploy');
        await writeFile(join(backendStage, 'current-backend.txt'), 'fresh backend');
      }
    },
    async inspectRuntime(input) {
      assert.deepEqual(input, { backendStage });
      await enter('runtime');
      assert.equal(await readFile(join(backendStage, 'current-backend.txt'), 'utf8'), 'fresh backend');
      assert.equal(await readFile(join(backendStage, 'e2e-dist/entry.js'), 'utf8'), 'export {};\n');
      return { version: 'synthetic-version' };
    },
    async verifyDatabase(input) {
      assert.deepEqual(input, { backendStage });
      await enter('database');
      return 'synthetic-sqlite-version';
    },
    async prepareNative(input) {
      assert.deepEqual(input, { backendStage, nativeStage, buildRoot });
      // Retain a failed delivery's partial output; never reuse the old stage.
      await mkdir(nativeStage);
      await writeFile(join(nativeStage, 'new-delivery.txt'), 'new delivery');
      await enter('native');
    },
  };
  return { input, backendStage, nativeStage, buildRoot, calls };
}

test('fresh Electron preparation requires the existing business gates and native delivery in order', async context => {
  const f = await fixture(context);
  await prepareElectronE2eBackend(f.input);
  assert.deepEqual(f.calls, phases);
  assert.equal(await readFile(join(f.nativeStage, 'new-delivery.txt'), 'utf8'), 'new delivery');
  assert.equal(await readFile(join(f.buildRoot, 'retained-evidence.txt'), 'utf8'), 'retained evidence');
});

for (const phase of phases) {
  test(`preparation rejects ${phase} failure without using a stale stage or erasing build evidence`, async context => {
    const f = await fixture(context, phase);
    await assert.rejects(prepareElectronE2eBackend(f.input), { message: `synthetic-${phase}-failure` });
    assert.deepEqual(f.calls, phases.slice(0, phases.indexOf(phase) + 1));
    assert.equal(await readFile(join(f.buildRoot, 'retained-evidence.txt'), 'utf8'), 'retained evidence');
    if (phase === 'native') {
      assert.equal(await readFile(join(f.nativeStage, 'new-delivery.txt'), 'utf8'), 'new delivery');
    } else {
      await assert.rejects(readFile(join(f.nativeStage, 'new-delivery.txt')), { code: 'ENOENT' });
    }
  });
}

test('rejects a relative preparation root before invoking any external preparation', async () => {
  let invoked = false;
  await assert.rejects(prepareElectronE2eBackend({
    root: 'relative-root',
    runPnpmCommand: async () => { invoked = true; },
  }), { message: 'ELECTRON_E2E_PREPARATION_ROOT_INVALID' });
  assert.equal(invoked, false);
});
