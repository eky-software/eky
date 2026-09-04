import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
  runHistoricalPackagedSmokeProcessChain,
  validateHistoricalPackagedSmokeResult,
} from './legacyUpgradeSourceSmoke.mjs';

function deferred() {
  let resolvePromise;
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

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
