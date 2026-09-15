import assert from 'node:assert/strict';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createUpgradeRollbackProgressWaiter,
  parseUpgradeRollbackProgressBytes,
} from './upgradeRollbackProgress.mjs';

const VALID_PREFIX = [
  {
    durationMs: 0,
    elapsedMs: 1,
    event: 'started',
    phase: 'inputValidation',
  },
  {
    durationMs: 2,
    elapsedMs: 3,
    event: 'completed',
    phase: 'inputValidation',
  },
  {
    durationMs: 0,
    elapsedMs: 4,
    event: 'started',
    phase: 'launcherExitWait',
  },
];

function jsonLines(records, trailingNewline = true) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}${
    trailingNewline ? '\n' : ''
  }`;
}

test('rollback progress accepts the strict launcher wait prefix', () => {
  assert.deepEqual(
    parseUpgradeRollbackProgressBytes(Buffer.from(jsonLines(VALID_PREFIX))),
    VALID_PREFIX,
  );
});

test('rollback progress ignores only an incomplete final record while writing', () => {
  const bytes = Buffer.from(
    `${jsonLines(VALID_PREFIX.slice(0, 2))}{"durationMs":0`,
  );
  assert.deepEqual(parseUpgradeRollbackProgressBytes(bytes), VALID_PREFIX.slice(0, 2));
});

test('rollback progress rejects unknown fields and impossible phase order', () => {
  assert.throws(
    () =>
      parseUpgradeRollbackProgressBytes(
        Buffer.from(
          jsonLines([{ ...VALID_PREFIX[0], path: 'C:\\private' }]),
        ),
      ),
    /binaryRollbackProgressInvalid/,
  );
  assert.throws(
    () =>
      parseUpgradeRollbackProgressBytes(
        Buffer.from(jsonLines([VALID_PREFIX[2]])),
      ),
    /binaryRollbackProgressInvalid/,
  );
  assert.throws(
    () =>
      parseUpgradeRollbackProgressBytes(
        Buffer.from(
          jsonLines([
            VALID_PREFIX[0],
            { ...VALID_PREFIX[1], elapsedMs: 0 },
          ]),
        ),
      ),
    /binaryRollbackProgressInvalid/,
  );
});

test('rollback progress waiter resolves from the existing safe progress channel', {
  timeout: 5_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'eky-v2-rollback-progress-'));
  const path = join(root, 'progress.jsonl');
  await writeFile(path, '', { encoding: 'ascii', flag: 'wx' });
  const waiter = createUpgradeRollbackProgressWaiter({
    event: 'started',
    path,
    phase: 'launcherExitWait',
  });
  try {
    await appendFile(path, jsonLines(VALID_PREFIX), 'utf8');
    await waiter.completion;
  } finally {
    waiter.close();
    await rm(root, { force: true, recursive: true });
  }
});
