import assert from 'node:assert/strict';
import { link, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import { readWindowsShortPathFixture } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';

import {
  describeHistoricalPackagedSmokeFailure,
  runHistoricalPackagedSmokeProcessChain,
  readHistoricalPackagedSmokeResult,
  validateHistoricalPackagedSmokeResult,
  waitForHistoricalPackagedSmokeResult,
} from './legacyUpgradeSourceSmoke.mjs';

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

test('historical watcher accepts the same directory through a Windows 8.3 alias', {
  skip: process.platform !== 'win32',
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-alias-'));
  let verified = false;
  t.after(() => verified ? rm(root, { force: true, recursive: true }) : undefined);
  const shortRoot = await readWindowsShortPathFixture(root, { directory: root });
  assert.notEqual(shortRoot, root, 'The fixture must exercise a real 8.3 alias');
  assert.match(shortRoot, /~[0-9]/);
  assert.equal(await realpath(shortRoot), await realpath(root));
  const child = deferred();
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  await writeFile(resultPath, '');
  const waiting = waitForHistoricalPackagedSmokeResult({
    childCompletion: child.promise,
    expectedStage: 'restoreRestart',
    expectedStatus: 'started',
    resultPath: resolve(shortRoot, 'desktop-smoke-result.json'),
  });
  const expected = { stage: 'restoreRestart', status: 'started' };
  await writeFile(resultPath, `${JSON.stringify(expected)}\n`);
  assert.deepEqual(await waiting, expected);
  verified = true;
});

for (const mode of ['missingDirectory', 'hold']) {
  test(`historical alias preparation fails closed before watching: ${mode}`, {
    skip: process.platform !== 'win32', timeout: 30_000,
  }, async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-alias-'));
    let verified = false;
    t.after(() => verified ? rm(root, { force: true, recursive: true }) : undefined);
    await assert.rejects(readWindowsShortPathFixture(root, {
      directory: mode === 'missingDirectory' ? join(root, 'missing') : root,
      hold: mode === 'hold',
    }), new RegExp(mode === 'hold' ? '^Error: WINDOWS_ACCEPTANCE_ALIAS_PREPARATION_TIMED_OUT$'
      : '^Error: WINDOWS_ACCEPTANCE_ALIAS_PREPARATION_FAILED$'));
    if (mode === 'hold') {
      assert.deepEqual(JSON.parse(await readFile(join(root, 'short-path-started.json'), 'utf8')),
        { schemaVersion: 1, phase: 'lookupHeld' });
    }
    await assert.rejects(readFile(join(root, 'short-path-result.json')), { code: 'ENOENT' });
    verified = true;
  });
}

test('historical watcher rejects a directory link before watching its target', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-linked-root-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const linked = resolve(root, 'linked');
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  await writeFile(resultPath, '{"stage":"restoreRestart","status":"started"}\n');
  await symlink(root, linked, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(waitForHistoricalPackagedSmokeResult({
    childCompletion: deferred().promise,
    expectedStage: 'restoreRestart',
    expectedStatus: 'started',
    resultPath: resolve(linked, 'desktop-smoke-result.json'),
  }), /sourcePackagedSmokeResultInvalid/);
});

test('historical watcher preserves child failure during asynchronous path validation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-child-failure-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  await writeFile(resultPath, '');
  await assert.rejects(waitForHistoricalPackagedSmokeResult({
    childCompletion: Promise.reject(new Error('syntheticChildFailure')),
    expectedStage: 'restoreRestart',
    expectedStatus: 'started',
    resultPath,
  }), /sourcePackagedSmokeExitedEarly/);
});

test('historical non-atomic progress writes remain pending until a complete result', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-write-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  await writeFile(resultPath, '', { flag: 'wx' });
  assert.equal(await readHistoricalPackagedSmokeResult(resultPath), null);
  await writeFile(resultPath, '{');
  assert.equal(await readHistoricalPackagedSmokeResult(resultPath), null);

  const child = deferred();
  const expected = { stage: 'restoreRestart', status: 'started' };
  const waiting = waitForHistoricalPackagedSmokeResult({
    childCompletion: child.promise,
    expectedStage: expected.stage,
    expectedStatus: expected.status,
    resultPath,
  });
  await writeFile(resultPath, `${JSON.stringify(expected)}\n`);
  child.resolve({ exitCode: 0 });
  assert.deepEqual(await waiting, expected);
});

test('historical incomplete progress at process exit remains a failure', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-incomplete-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  for (const content of ['', '{']) {
    await writeFile(resultPath, content);
    await assert.rejects(
      waitForHistoricalPackagedSmokeResult({
        childCompletion: Promise.resolve({ exitCode: 0 }),
        expectedStage: 'restoreRestart',
        expectedStatus: 'started',
        resultPath,
      }),
      /sourcePackagedSmokeExitedEarly/,
    );
  }
});

test('historical progress still rejects malformed, oversized and linked results', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-invalid-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  for (const content of ['{\n', 'x'.repeat(4_097)]) {
    await writeFile(resultPath, content);
    await assert.rejects(
      readHistoricalPackagedSmokeResult(resultPath),
      /sourcePackagedSmokeResultInvalid/,
    );
  }
  await writeFile(resultPath, '{"stage":"startup","status":"started"}\n');
  await link(resultPath, resolve(root, 'linked-result.json'));
  await assert.rejects(
    readHistoricalPackagedSmokeResult(resultPath),
    /sourcePackagedSmokeResultInvalid/,
  );
});

test('historical smoke result has a closed schema', () => {
  assert.deepEqual(
    validateHistoricalPackagedSmokeResult({
      stage: 'restoreRestart',
      status: 'started',
    }),
    { stage: 'restoreRestart', status: 'started' },
  );
  assert.throws(
    () =>
      validateHistoricalPackagedSmokeResult({
        stage: 'shutdown',
        status: 'ok',
        electronVersion: '43.3.0',
        path: 'C:\\private',
      }),
    /sourcePackagedSmokeResultInvalid/,
  );
});

test('historical smoke chain starts exactly one initial and restored generation', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'result', 'desktop-smoke-result.json');
  const phases = [];
  const initial = deferred();
  const restored = deferred();
  const running = runHistoricalPackagedSmokeProcessChain({
    resultPath,
    async startGeneration(phase) {
      phases.push(phase);
      if (phase === 'initial') {
        await writeFile(
          resultPath,
          `${JSON.stringify({ stage: 'restoreRestart', status: 'started' })}\n`,
        );
        initial.resolve({ exitCode: 0 });
        return { completion: initial.promise };
      }
      await writeFile(
        resultPath,
        `${JSON.stringify({ stage: 'shutdown', status: 'ok', electronVersion: '43.3.0' })}\n`,
      );
      restored.resolve({ exitCode: 0 });
      return { completion: restored.promise };
    },
  });
  assert.equal((await running).contract, 'explicitTwoPhase');
  assert.deepEqual(phases, ['initial', 'restored']);
});

test('historical smoke chain rejects a failed generation without adding another', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-fail-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'result', 'desktop-smoke-result.json');
  let starts = 0;
  await assert.rejects(
    runHistoricalPackagedSmokeProcessChain({
      resultPath,
      async startGeneration() {
        starts += 1;
        await writeFile(
          resultPath,
          `${JSON.stringify({ stage: 'backend', status: 'failed', code: 'BACKEND_FAILED' })}\n`,
        );
        return { completion: Promise.resolve({ exitCode: 1 }) };
      },
    }),
    /sourcePackagedSmokeFailed/,
  );
  assert.equal(starts, 1);
});

test('restored smoke failure retains its generation without exposing the application code', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'eky-legacy-smoke-restored-fail-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const resultPath = resolve(root, 'desktop-smoke-result.json');
  const starts = [];
  await assert.rejects(runHistoricalPackagedSmokeProcessChain({
    resultPath,
    async startGeneration(generation) {
      starts.push(generation);
      const value = generation === 'initial'
        ? { stage: 'restoreRestart', status: 'started' }
        : { stage: 'secondBackup', status: 'failed', code: 'PRIVATE_APPLICATION_DETAIL' };
      await writeFile(resultPath, `${JSON.stringify(value)}\n`);
      return { completion: Promise.resolve({ exitCode: generation === 'initial' ? 0 : 1 }) };
    },
  }), (error) => {
    assert.equal(error.message, 'sourcePackagedSmokeFailed');
    assert.deepEqual(describeHistoricalPackagedSmokeFailure(error), {
      smokeReason: 'applicationReportedFailure', smokeStage: 'secondBackup',
      smokeStatus: 'failed', smokeGeneration: 'restored',
    });
    return true;
  });
  assert.deepEqual(starts, ['initial', 'restored']);
  assert.deepEqual(describeHistoricalPackagedSmokeFailure({
    evidence: { smokeReason: 'private-data', secret: 'private-data' },
  }), {});
});
