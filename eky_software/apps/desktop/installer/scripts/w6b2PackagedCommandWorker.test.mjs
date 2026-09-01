import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';

import {
  createW6b2PackagedE2eBuildInvocation,
  parseW6b2PackagedCommandWorkerArguments,
  runW6b2PackagedCommandWorker,
} from './w6b2PackagedCommandWorker.mjs';

const proofToken = 'b'.repeat(64);

test('uses the current Node process with an exact pnpm entry', () => {
  const pnpmCliPath = resolve('fixture', 'pnpm.js');
  const nodeExecutable = resolve('fixture', 'node.exe');

  assert.deepEqual(
    createW6b2PackagedE2eBuildInvocation({
      nodeExecutable,
      pnpmCliPath,
    }),
    {
      arguments: [
        pnpmCliPath,
        '--filter',
        '@eky/desktop',
        'e2e:build',
      ],
      command: nodeExecutable,
    },
  );
  assert.throws(
    () =>
      createW6b2PackagedE2eBuildInvocation({
        nodeExecutable,
        pnpmCliPath: 'pnpm.cmd',
      }),
    /W6B2_PACKAGED_WORKER_PNPM_UNAVAILABLE/u,
  );
  assert.throws(
    () =>
      createW6b2PackagedE2eBuildInvocation({
        nodeExecutable: 'node',
        pnpmCliPath,
      }),
    /W6B2_PACKAGED_WORKER_PNPM_UNAVAILABLE/u,
  );
});

test('builds E2E once before a selected success scenario', async () => {
  const calls = [];
  const result = await runWorker(
    ['--kind=success', `--process-proof-token=${proofToken}`, '--run=1'],
    {
      async runE2eBuild() {
        calls.push('build');
      },
      async runSuccess(options) {
        calls.push(`success:${options.runNumbers.join(',')}`);
        return { status: 'completed' };
      },
    },
  );

  assert.deepEqual(calls, ['build', 'success:1']);
  assert.deepEqual(result, { status: 'completed' });
});

test('builds E2E once before a selected fault scenario', async () => {
  const calls = [];
  await runWorker(
    [
      '--kind=faultRollback',
      `--process-proof-token=${proofToken}`,
      '--scenario=acceptanceInterruption',
      '--run=2',
    ],
    {
      async runE2eBuild() {
        calls.push('build');
      },
      async runFaultRollback(options) {
        calls.push(
          `${options.scenarios.join(',')}:${options.runNumbers.join(',')}`,
        );
      },
    },
  );

  assert.deepEqual(calls, ['build', 'acceptanceInterruption:2']);
});

test('rejects malformed ownership arguments before build', async () => {
  let buildCount = 0;
  await assert.rejects(
    runWorker(
      ['--kind=success', '--process-proof-token=foreign', '--run=1'],
      {
        async runE2eBuild() {
          buildCount += 1;
        },
      },
    ),
    /W6B2_PACKAGED_WORKER_ARGUMENTS_INVALID/u,
  );
  assert.equal(buildCount, 0);
  assert.throws(
    () =>
      parseW6b2PackagedCommandWorkerArguments([
        '--kind=foreign',
        `--process-proof-token=${proofToken}`,
      ]),
    /W6B2_PACKAGED_WORKER_ARGUMENTS_INVALID/u,
  );
});

test('build failure prevents scenario and emits only safe failure', async () => {
  let scenarioCount = 0;
  const events = [];
  await assert.rejects(
    runWorker(
      ['--kind=success', `--process-proof-token=${proofToken}`, '--run=1'],
      {
        observe: (event) => events.push(event),
        async runE2eBuild() {
          throw new Error('C:\\private secret stack');
        },
        async runSuccess() {
          scenarioCount += 1;
        },
      },
    ),
    /W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED/u,
  );

  assert.equal(scenarioCount, 0);
  const output = JSON.stringify(events);
  assert.match(output, /W6B2_PACKAGED_WORKER_E2E_BUILD_FAILED/u);
  assert.doesNotMatch(output, /private|secret|stack|bbbbbbbb/iu);
});

test('scenario failure preserves safe terminal evidence', async () => {
  const events = [];
  await assert.rejects(
    runWorker(
      ['--kind=success', `--process-proof-token=${proofToken}`, '--run=2'],
      {
        observe: (event) => events.push(event),
        async runE2eBuild() {},
        async runSuccess() {
          throw new Error('private scenario failure');
        },
      },
    ),
    /W6B2_PACKAGED_WORKER_SCENARIO_FAILED/u,
  );

  assert.equal(
    events.some(
      ({ errorCode, phase }) =>
        phase === 'scenario' &&
        errorCode === 'W6B2_PACKAGED_WORKER_SCENARIO_FAILED',
    ),
    true,
  );
  assert.doesNotMatch(JSON.stringify(events), /private|bbbbbbbb/iu);
});

function runWorker(arguments_, overrides) {
  return runW6b2PackagedCommandWorker(arguments_, {
    dependencies: {
      now: () => 1_000,
      observe() {},
      async runE2eBuild() {},
      async runFaultRollback() {},
      async runSuccess() {},
      ...overrides,
    },
  });
}
