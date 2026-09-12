import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import test from 'node:test';

import { createWorkspacePhaseWriter, WORKSPACE_PHASE_QUEUE_CAPACITY } from './workspacePhaseWriter.mjs';
import { encodeWorkspacePhaseObservation, parseWorkspacePhaseObservation } from './workspacePhaseObservation.mjs';

const observation = Object.freeze({
  schemaVersion: 1, operation: 'workspaceAcceptanceCaller', scenario: 'packagedWorkspaceSuccess',
  phase: 'supervisorExit', status: 'completed', durationMs: 0, elapsedMs: 1,
});

function writerFixture({ closeOnKill = true } = {}) {
  const child = new EventEmitter();
  const writes = [];
  child.pid = 1234;
  child.stdin = new Writable({ write(bytes, _encoding, callback) { writes.push({ bytes, callback }); } });
  let kills = 0;
  let starts = 0;
  child.kill = () => {
    kills += 1;
    if (closeOnKill) queueMicrotask(() => child.emit('close', null, 'SIGTERM'));
    return true;
  };
  const writer = createWorkspacePhaseWriter({
    timeoutMilliseconds: 100, terminationTimeoutMilliseconds: 5,
    spawnProcess() { starts += 1; return child; },
  });
  return { writer, child, writes, get kills() { return kills; }, get starts() { return starts; } };
}

test('phase observation has exact versioned fields and safe values', () => {
  assert.deepEqual(parseWorkspacePhaseObservation(encodeWorkspacePhaseObservation(observation)), observation);
  for (const phase of ['productChannelSetup', 'productSupervisorWait', 'productSupervisorExit',
    'productSupervisorClose', 'productChannelCleanup', 'productHostLaunch', 'productHostSpawn',
    'productHostDeadline', 'productHostTermination']) {
    const value = { ...observation, phase };
    assert.deepEqual(parseWorkspacePhaseObservation(encodeWorkspacePhaseObservation(value)), value);
  }
  const forbidden = ['path', 'pid', 'command', 'session', 'companyId', 'error', 'stack', 'metadata', 'resultCode'];
  for (const key of forbidden) {
    assert.throws(() => encodeWorkspacePhaseObservation({ ...observation, [key]: 'synthetic-private' }));
    assert.throws(() => parseWorkspacePhaseObservation(Buffer.from(JSON.stringify({ ...observation, [key]: 'synthetic-private' }))));
  }
  for (const [key, value] of [['schemaVersion', 2], ['phase', 'unknown'], ['status', 'unknown'],
    ['scenario', 'unknown'], ['durationMs', -1], ['elapsedMs', Infinity]]) {
    assert.throws(() => encodeWorkspacePhaseObservation({ ...observation, [key]: value }));
  }
  assert.throws(() => parseWorkspacePhaseObservation(Buffer.from(JSON.stringify(observation).replace('{', '{"schemaVersion":1,'))));
  assert.throws(() => parseWorkspacePhaseObservation(Buffer.alloc(513, 32)));
  assert.throws(() => encodeWorkspacePhaseObservation({ ...observation,
    get phase() { assert.fail('Accessors must not run at the output boundary'); },
  }), { message: 'WINDOWS_ACCEPTANCE_PHASE_OBSERVATION_INVALID' });
  assert.throws(() => encodeWorkspacePhaseObservation({ ...observation, [Symbol('private')]: 'private' }));
});

test('writer bounds the queue and does not wait for a write acknowledgement', async () => {
  const fixture = writerFixture();
  try {
    for (let i = 0; i < WORKSPACE_PHASE_QUEUE_CAPACITY + 1; i += 1) {
      assert.equal(fixture.writer.send(observation), true);
    }
    for (let i = 0; i < 1_000; i += 1) assert.equal(fixture.writer.send(observation), false);
    assert.equal(fixture.writes.length, 1);
    const completion = fixture.writer.finish();
    assert.strictEqual(fixture.writer.finish(), completion);
    const result = await completion;
    assert.equal(result.diagnosticResultCode, 'messagesDropped');
    assert.equal(result.writerResultCode, 'writerAbsent');
    assert.equal(fixture.kills, 1);
    assert.equal(fixture.starts, 1);
    assert.equal(fixture.child.stdin.destroyed, true);
  } finally { await fixture.writer.finish(); }
});

test('invalid fields never reach the channel and a broken channel is not replaced', async () => {
  const fixture = writerFixture();
  assert.equal(fixture.writer.send({ ...observation, path: 'synthetic-private' }), false);
  assert.equal(fixture.writes.length, 0);
  assert.equal(fixture.writer.send(observation), true);
  fixture.writes[0].callback(new Error('synthetic channel error'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.writer.send(observation), false);
  const result = await fixture.writer.finish();
  assert.equal(result.diagnosticResultCode, 'channelFailed');
  assert.equal(result.writerResultCode, 'writerAbsent');
  assert.equal(fixture.starts, 1);
});

test('unverified writer cleanup cannot be replaced by a late exit receipt', async () => {
  const fixture = writerFixture({ closeOnKill: false });
  const result = await fixture.writer.finish();
  assert.equal(result.writerResultCode, 'writerExitUnverified');
  assert.equal(result.processResult.resultCode, 'terminationUnconfirmed');
  fixture.child.emit('close', 0, null);
  assert.equal(result.writerResultCode, 'writerExitUnverified');
  assert.equal(fixture.kills, 1);
});
