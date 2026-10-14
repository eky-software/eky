import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { prepareElectronE2eBackend } from './prepare-electron-e2e-backend.mjs';
import { InspectionNativeCompilationFailure, inspectionNativeCompilationFailure } from '../../backend/scripts/build-profile-inspection-native.mjs';

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
      assert.deepEqual(Object.keys(input).sort(), ['backendStage', 'buildRoot', 'nativeStage']);
      assert.equal(input.backendStage, backendStage);
      assert.equal(input.nativeStage, nativeStage);
      assert.equal(dirname(input.buildRoot), await realpath(dirname(buildRoot)));
      assert.match(input.buildRoot.slice(dirname(input.buildRoot).length + 1), /^e2e-[A-Za-z0-9]{6}$/u);
      assert.ok((await lstat(input.buildRoot)).isDirectory());
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

const evidenceEnvironment = { GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
  GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'e2e-electron-windows-critical',
  EKY_EVIDENCE_JOB_KEY: 'core-electron-0', GITHUB_RUN_ID: '123', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a'.repeat(40) };

for (const variant of ['compilation', 'unsettledCompiler', 'differentFailure', 'genericBuildFailure', 'wrongJob', 'success', 'writeFailure', 'missingLog']) {
  test(`Windows preparation evidence preserves first failure and scope: ${variant}`, {
    skip: process.platform !== 'win32',
  }, async context => {
    const f = await fixture(context);
    const original = variant === 'differentFailure' ? Error('PROFILE_INSPECTION_NATIVE_SOURCE_INVALID')
      : variant === 'genericBuildFailure' ? Error('PROFILE_INSPECTION_NATIVE_BUILD_FAILED')
        : new InspectionNativeCompilationFailure(variant !== 'unsettledCompiler');
    let owned;
    f.input.environment = { ...evidenceEnvironment,
      ...(variant === 'wrongJob' ? { GITHUB_JOB: 'other' } : {}) };
    f.input.prepareNative = async ({ buildRoot }) => {
      owned = buildRoot;
      const work = join(buildRoot, 'inspection-native-ABC123');
      await mkdir(work, { mode: 0o700 });
      if (variant !== 'missingLog') await writeFile(join(work, 'build.private.log'), 'synthetic compiler original',
        { flag: 'wx', mode: 0o600 });
      if (variant !== 'success') throw original;
    };
    if (variant === 'writeFailure') {
      await mkdir(join(f.input.root, 'apps/e2e'), { recursive: true });
      await writeFile(join(f.input.root, 'apps/e2e/test-results'), 'not a directory');
    }
    if (variant === 'success') await prepareElectronE2eBackend(f.input);
    else await assert.rejects(prepareElectronE2eBackend(f.input), error => error === original);
    assert.ok((await lstat(owned)).isDirectory());
    const results = join(f.input.root, 'apps/e2e/test-results');
    if (!['compilation', 'missingLog', 'unsettledCompiler'].includes(variant)) {
      if (variant !== 'writeFailure') await assert.rejects(readdir(results), { code: 'ENOENT' });
      return;
    }
    const [run] = await readdir(results);
    const record = JSON.parse(await readFile(join(results, run, 'preparation/process-output.private.json'), 'utf8'));
    assert.equal(run, `run-${record.invocationId}`);
    assert.equal(record.binding.sourceRevision, evidenceEnvironment.GITHUB_SHA);
    assert.equal(record.nativeCompilationEvidence.status, variant === 'missingLog' ? 'missing'
      : variant === 'unsettledCompiler' ? 'unverified' : 'retained');
    if (variant === 'compilation') assert.equal(Buffer.from(record.nativeCompilationEvidence.prefixBase64, 'base64').toString(),
      'synthetic compiler original');
  });
}

test('only normal nonzero compiler exit grants the same-code private preparation classification', () => {
  const failure = inspectionNativeCompilationFailure({ status: 1, signal: null });
  assert.ok(failure instanceof InspectionNativeCompilationFailure);
  assert.equal(failure.logSettled, true);
  assert.equal(String(failure), 'Error: PROFILE_INSPECTION_NATIVE_BUILD_FAILED');
  assert.deepEqual(Object.keys(failure), []);
  for (const result of [{ status: 0, signal: null }, { status: null, signal: 'SIGTERM' },
    { status: 1, signal: null, error: Error('ETIMEDOUT') }, { status: null, signal: null },
    { status: 1, signal: 'SIGKILL' }]) {
    const rejected = inspectionNativeCompilationFailure(result);
    assert.equal(rejected instanceof InspectionNativeCompilationFailure, true);
    assert.equal(rejected.logSettled, false);
    assert.equal(rejected.message, failure.message);
    assert.deepEqual(Object.keys(rejected), []);
  }
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
