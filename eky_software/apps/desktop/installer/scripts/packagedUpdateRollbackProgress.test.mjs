import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPackagedUpdateRollbackProgressTail,
  packagedUpdateRollbackEvents,
  packagedUpdateRollbackPhases,
  parsePackagedUpdateRollbackProgress,
} from './packagedUpdateRollbackProgress.mjs';

describe('packaged update rollback progress', () => {
  it('accepts every reviewed rollback phase and terminal event', () => {
    const records = packagedUpdateRollbackPhases.flatMap((phase) =>
      packagedUpdateRollbackEvents.map((event, index) => ({
        durationMs: index * 10,
        elapsedMs: index * 20,
        event,
        phase,
      })),
    );

    assert.deepEqual(
      parsePackagedUpdateRollbackProgress(toJsonLines(records)),
      records,
    );
  });

  it('rejects unknown phases, events, extra fields and raw diagnostic data', () => {
    const valid = createRecord();
    for (const invalid of [
      { ...valid, event: 'heartbeat' },
      { ...valid, phase: 'C:\\private\\installer' },
      { ...valid, commandLine: 'msiexec /i secret.msi' },
      { ...valid, error: { message: 'raw error', stack: 'raw stack' } },
    ]) {
      assert.throws(
        () => parsePackagedUpdateRollbackProgress(toJsonLines([invalid])),
        /PACKAGED_UPDATE_ROLLBACK_PROGRESS_/,
      );
    }
  });

  it('ignores an incomplete trailing record while a writer is appending', () => {
    const complete = createRecord();
    assert.deepEqual(
      parsePackagedUpdateRollbackProgress(
        `${JSON.stringify(complete)}\n{"event":"started"`,
      ),
      [complete],
    );
  });

  it('reports each complete record only once across repeated polls', async () => {
    const first = createRecord();
    const second = createRecord({
      durationMs: 25,
      elapsedMs: 30,
      event: 'completed',
    });
    let content = toJsonLines([first]);
    const reported = [];
    const tail = createPackagedUpdateRollbackProgressTail({
      readProgress: async () => content,
      reportProgress: (record) => reported.push(record),
    });

    await tail.poll();
    await tail.poll();
    content = toJsonLines([first, second]);
    await tail.poll();

    assert.deepEqual(reported, [first, second]);
  });

  it('never lets missing or invalid progress change the scenario result', async () => {
    let readCount = 0;
    const tail = createPackagedUpdateRollbackProgressTail({
      readProgress: async () => {
        readCount += 1;
        if (readCount === 1) {
          throw new Error('C:\\private\\progress.jsonl');
        }
        return '{"event":"unknown"}\n';
      },
      reportProgress: () => {
        throw new Error('writer failed');
      },
    });

    await assert.doesNotReject(tail.poll());
    await assert.doesNotReject(tail.poll());
  });
});

function createRecord(overrides = {}) {
  return {
    durationMs: 0,
    elapsedMs: 0,
    event: 'started',
    phase: 'inputValidation',
    ...overrides,
  };
}

function toJsonLines(records) {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}
