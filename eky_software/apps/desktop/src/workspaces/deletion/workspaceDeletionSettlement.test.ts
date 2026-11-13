import { expect, it } from 'vitest';
import { createWorkspaceDeletionSettlementObservation } from './workspaceDeletionSettlementTestSupport.js';

it('preserves synchronous receiver, argument, result and receipt timing', () => {
  const observation = createWorkspaceDeletionSettlementObservation(), receipt = Object.freeze({ removed: true });
  const owner = { calls: 0, record: observation.sync('recordRemoved', function(this: { calls: number }, value: object) {
    this.calls++; expect(value).toBe(receipt); return receipt;
  }) };
  expect(owner.record(receipt)).toBe(receipt); expect(owner.calls).toBe(1);
  expect(observation.read().events).toEqual([
    { phase: 'recordRemoved', state: 'entered', call: 1 }, { phase: 'recordRemoved', state: 'fulfilled', call: 1 },
  ]);
});

it('preserves a synchronous throw even at a promise-returning boundary', () => {
  const observation = createWorkspaceDeletionSettlementObservation(), first = new Error('SYNTHETIC_FIRST');
  for (const wrap of [observation.sync, observation.async]) {
    const work = wrap('finalizer', () => { throw first; });
    expect(work).toThrow(first);
  }
  expect(observation.read().counters.finalizer).toMatchObject({ entered: 2, rejected: 2, fulfilled: 0, pending: 0 });
});

it('does not resolve a held call or replace its promise, receiver or arguments', async () => {
  const observation = createWorkspaceDeletionSettlementObservation(), value = {}, receiver = {};
  let release!: (value: object) => void;
  const pending = new Promise<object>(resolve => { release = resolve; });
  const work = observation.async('ownerClose', function(this: object, input: object) {
    expect(this).toBe(receiver); expect(input).toBe(value); return pending;
  });
  expect(work.call(receiver, value)).toBe(pending);
  expect(observation.read().counters.ownerClose).toMatchObject({ entered: 1, pending: 1, fulfilled: 0 });
  release(value); expect(await pending).toBe(value);
  expect(observation.read().counters.ownerClose).toMatchObject({ entered: 1, pending: 0, fulfilled: 1 });
});

it('keeps first failure and separate close rejection unchanged', async () => {
  const observation = createWorkspaceDeletionSettlementObservation();
  const first = new Error('SYNTHETIC_ORIGINAL'), cleanup = new Error('SYNTHETIC_CLOSE');
  const run = observation.async('recovery', () => Promise.reject(first));
  const close = observation.async('ownerClose', () => Promise.reject(cleanup));
  await expect(run()).rejects.toBe(first); await expect(close()).rejects.toBe(cleanup);
  expect(observation.read().counters.recovery).toMatchObject({ rejected: 1, pending: 0 });
  expect(observation.read().counters.ownerClose).toMatchObject({ rejected: 1, pending: 0 });
  expect(JSON.stringify(observation.read())).not.toContain('SYNTHETIC_');
});

it('preserves the owning caller aggregate when close follows a failed operation', async () => {
  const observation = createWorkspaceDeletionSettlementObservation();
  const first = new Error('SYNTHETIC_ORIGINAL'), cleanup = new Error('SYNTHETIC_CLOSE');
  const aggregate = new AggregateError([first, cleanup], 'SYNTHETIC_OWNER_AGGREGATE', { cause: first });
  const work = observation.async('finalizer', () => Promise.reject(first));
  const close = observation.async('ownerClose', () => Promise.reject(cleanup));
  const caller = observation.async('recovery', async () => {
    const failures: unknown[] = [];
    try { await work(); } catch (error) { failures.push(error); }
    try { await close(); } catch (error) { failures.push(error); }
    expect(failures).toEqual([first, cleanup]);
    throw aggregate;
  });
  await expect(caller()).rejects.toBe(aggregate);
  expect(aggregate.cause).toBe(first);
  expect(observation.read().events.map(event => `${event.phase}:${event.state}`)).toEqual([
    'recovery:entered', 'finalizer:entered', 'finalizer:rejected', 'ownerClose:entered',
    'ownerClose:rejected', 'recovery:rejected',
  ]);
});

it('counts concurrent calls separately and keeps old snapshots immutable', async () => {
  const observation = createWorkspaceDeletionSettlementObservation();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const work = observation.async('completionSend', () => pending);
  work(); work(); const before = observation.read();
  expect(before.counters.completionSend).toMatchObject({ entered: 2, pending: 2 });
  release(); await pending;
  expect(before.counters.completionSend!.pending).toBe(2);
  expect(observation.read().counters.completionSend).toMatchObject({ entered: 2, fulfilled: 2, pending: 0 });
  expect(Object.isFrozen(before.counters.completionSend)).toBe(true);
  expect(Object.isFrozen(before.events[0])).toBe(true);
});

it('bounds detail without losing counters or inventing an unobserved phase', () => {
  const observation = createWorkspaceDeletionSettlementObservation(), run = observation.sync('recordRemoved', () => undefined);
  for (let index = 0; index < 100; index++) run();
  const report = observation.read();
  expect(report.events).toHaveLength(128); expect(report.truncated).toBe(true);
  expect(report.counters.recordRemoved).toMatchObject({ entered: 100, fulfilled: 100, pending: 0 });
  expect(report.counters.leaseRelease).toMatchObject({ entered: 0, fulfilled: 0, rejected: 0, pending: 0 });
});
