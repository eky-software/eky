import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  parseW6bLegacyUpgradeCommandWorkerArguments,
  runW6bLegacyUpgradeCommand,
  runW6bLegacyUpgradeCommandWorker,
  W6B_LEGACY_COMMAND_TIMEOUT_MILLISECONDS,
} from './runW6bLegacyUpgradeCommand.mjs';
import { W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS } from './w6bLegacyAcceptanceProcess.mjs';

const proofToken = 'a'.repeat(64);

test('keeps the full legacy command inside the outer CI budget', () => {
  assert.equal(W6B_LEGACY_COMMAND_TIMEOUT_MILLISECONDS, 25 * 60 * 1000);
  assert.ok(
    W6B_LEGACY_COMMAND_TIMEOUT_MILLISECONDS +
      W6B_LEGACY_ACCEPTANCE_CLEANUP_TIMEOUT_MILLISECONDS <
      30 * 60 * 1000,
  );
});

test('owns the complete legacy command in one bounded worker process', async () => {
  const calls = [];
  const result = await runW6bLegacyUpgradeCommand([], {
    dependencies: {
      createProcessProofToken: () => proofToken,
      async runProcess(command, arguments_, context) {
        calls.push({ arguments_, command, context });
        return { exitCode: 0, status: 'completed' };
      },
    },
  });

  assert.deepEqual(result, { exitCode: 0, status: 'completed' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.match(
    calls[0].arguments_[0],
    /runW6bLegacyUpgradeCommand\.mjs$/u,
  );
  assert.deepEqual(calls[0].arguments_.slice(1), [
    '--worker',
    `--process-proof-token=${proofToken}`,
  ]);
  assert.deepEqual(calls[0].context, { processProofToken: proofToken });
});

test('worker validates exact arguments before running acceptance', async () => {
  let acceptanceCount = 0;
  const arguments_ = ['--worker', `--process-proof-token=${proofToken}`];

  assert.deepEqual(parseW6bLegacyUpgradeCommandWorkerArguments(arguments_), {
    processProofToken: proofToken,
  });
  const result = await runW6bLegacyUpgradeCommandWorker(arguments_, {
    dependencies: {
      async runAcceptance() {
        acceptanceCount += 1;
        return { sourceVersion: '0.2.6', targetVersion: '0.2.7' };
      },
    },
  });

  assert.equal(acceptanceCount, 1);
  assert.deepEqual(result, {
    sourceVersion: '0.2.6',
    targetVersion: '0.2.7',
  });
});

test('rejects foreign command and worker arguments fail closed', async () => {
  await assert.rejects(
    runW6bLegacyUpgradeCommand(['--worker']),
    /W6B_LEGACY_COMMAND_ARGUMENTS_INVALID/u,
  );
  await assert.rejects(
    runW6bLegacyUpgradeCommand([], {
      dependencies: { createProcessProofToken: () => 'foreign' },
    }),
    /W6B_LEGACY_COMMAND_PROOF_TOKEN_INVALID/u,
  );
  assert.throws(
    () =>
      parseW6bLegacyUpgradeCommandWorkerArguments([
        '--worker',
        '--process-proof-token=foreign',
      ]),
    /W6B_LEGACY_COMMAND_WORKER_ARGUMENTS_INVALID/u,
  );
  assert.throws(
    () =>
      parseW6bLegacyUpgradeCommandWorkerArguments([
        '--worker',
        `--process-proof-token=${proofToken}`,
        '--foreign',
      ]),
    /W6B_LEGACY_COMMAND_WORKER_ARGUMENTS_INVALID/u,
  );
});

test('package command cannot bypass the full legacy command owner', async () => {
  const packageJson = JSON.parse(
    await readFile(new URL('../../package.json', import.meta.url), 'utf8'),
  );

  assert.equal(
    packageJson.scripts['installer:w6b-legacy'],
    'node installer/scripts/runW6bLegacyUpgradeCommand.mjs',
  );
});
