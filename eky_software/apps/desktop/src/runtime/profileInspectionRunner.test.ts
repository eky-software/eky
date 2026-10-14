import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createProfileInspectionCommand, parseProfileInspectionStatus,
  profileInspectionProtocolVersion, profileInspectionWorkMilliseconds,
  type ColdProfileInspectionReceipt, type ProfileInspectionColdSources, type ProfileInspectionCommand, type ProfileInspectionReceipt,
  type OriginalProfileInspectionReceipt, type ProfileInspectionOriginalSources,
} from './profileInspectionMessages.js';
import { startProfileInspectionRunner, type ProfileInspectionRunnerPort } from './profileInspectionRunner.js';
import type { WorkspaceProcessReservation } from './workspaceProcessReservation.js';

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const generationId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const runtimeSession = 'c'.repeat(43);
const reservationIdentity = 'd'.repeat(64);
const identity = { protocolVersion: profileInspectionProtocolVersion, operationId, generationId, runtimeSession } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

describe('fixed profile inspection runner', () => {
  it.each(['active', 'rollback', 'absent'] as const)('dispatches original %s only after grant and retains its distinct role', async databaseSlot => {
    const sources = { workspaceRoot: resolve('private-workspace'), layout: 'profileRestore', databaseSlot, documentsSlot: 'rollback' } as const;
    const fixture = createFixture();
    fixture.run.mockResolvedValue(originalReceipt(sources));
    const prepared = originalCommand(sources);
    fixture.port.send(prepared);
    await flushTasks();
    expect(fixture.loadOperation).not.toHaveBeenCalled();
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.loadOperation.mock.calls[0]?.[2]).toBe('inspectColdRestoreOriginal');
    expect(fixture.run.mock.calls[0]?.[0]).toEqual({ kind: 'inspectColdRestoreOriginal', ...sources, operationId,
      anchorRoot: resolve('private-inspection-staging', operationId),
      inspectionRoot: resolve('private-inspection-staging', `profile-inspection-${generationId}`),
      migrationsDirectory: resolve('private-backend', 'migrations'), nativeResourceRoot: resolve('private-native') });
    expect(fixture.port.statuses().at(-1)).toEqual({ ...identity, type: 'originalCompleted', result: originalReceipt(sources) });
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['forward', 'layout', 'databaseSlot', 'documentsSlot', 'inventedAbsenceHealth'] as const)
    ('rejects incorrect original result: %s', async variant => {
      const sources = { workspaceRoot: resolve('private-workspace'), layout: 'profileRestore', databaseSlot: 'absent', documentsSlot: 'absent' } as const;
      const fixture = createFixture();
      const result = originalReceipt(sources);
      fixture.run.mockResolvedValue(variant === 'forward' ? coldReceipt({ databaseSlot: 'active', documentsSlot: 'active' })
        : variant === 'inventedAbsenceHealth' ? { ...result, databaseHealth: 'healthy' }
          : { ...result, [variant]: variant === 'layout' ? 'workspaceReplacement' : 'rollback' });
      fixture.port.send(originalCommand(sources));
      await flushTasks();
      fixture.port.send(command('grant'));
      await flushTasks();
      expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
      fixture.port.send(command('shutdown'));
      expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

  it.each([
    ['active', 'active'], ['active', 'staged'], ['staged', 'active'], ['staged', 'staged'],
  ] as const)('binds cold content to the selected %s database and %s documents', async (databaseSlot, documentsSlot) => {
    const sources = { workspaceRoot: resolve('private-workspace'), databaseSlot, documentsSlot };
    const fixture = createFixture();
    fixture.run.mockResolvedValue(coldReceipt(sources));
    fixture.port.send(coldCommand(sources));
    await flushTasks();
    expect(fixture.loadOperation).not.toHaveBeenCalled();
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.loadOperation.mock.calls[0]?.[2]).toBe('inspectColdRestoreContent');
    expect(fixture.run.mock.calls[0]?.[0]).toEqual({ kind: 'inspectColdRestoreContent', ...sources, operationId,
      stagingRoot: resolve('private-inspection-staging'),
      inspectionRoot: resolve('private-inspection-staging', `profile-inspection-${generationId}`),
      migrationsDirectory: resolve('private-backend', 'migrations'), nativeResourceRoot: resolve('private-native') });
    expect(fixture.port.statuses().map(status => status.type)).toEqual(['ready', 'reservationReady', 'coldCompleted']);
    expect(fixture.exit).not.toHaveBeenCalled();
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['portable', 'databaseSlot', 'documentsSlot', 'fabricatedCatalog'] as const)
    ('rejects a mismatched cold result: %s', async variant => {
      const sources = { workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'staged' } as const;
      const fixture = createFixture();
      const content = coldReceipt(sources);
      fixture.run.mockResolvedValue(variant === 'portable' ? receipt() : variant === 'fabricatedCatalog'
        ? { ...content, artifactCatalog: receipt().artifactCatalog }
        : { ...content, [variant]: variant === 'databaseSlot' ? 'staged' : 'active' });
      fixture.port.send(coldCommand(sources));
      await flushTasks();
      fixture.port.send(command('grant'));
      await flushTasks();
      expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
      expect(fixture.port.statuses().some(status => status.type === 'completed' || status.type === 'coldCompleted')).toBe(false);
      fixture.port.send(command('shutdown'));
      expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

  it('refuses a cold receipt for portable work', async () => {
    const fixture = createFixture();
    fixture.run.mockResolvedValue(coldReceipt({ databaseSlot: 'active', documentsSlot: 'staged' }));
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('exits without releasing live ownership when the cold terminal cannot be delivered', async () => {
    const sources = { workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'staged' } as const;
    const fixture = createFixture({}, 'coldCompleted');
    fixture.run.mockResolvedValue(coldReceipt(sources));
    fixture.port.send(coldCommand(sources));
    await flushTasks();
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not accept cold completion after the existing work deadline or release a live owner', async () => {
    const work = deferred<ColdProfileInspectionReceipt>();
    const sources = { workspaceRoot: resolve('private-workspace'), databaseSlot: 'active', documentsSlot: 'staged' } as const;
    const fixture = createFixture({ loadOperation: async (_deployment, beginLoad) => { beginLoad(); return async () => work.promise; } });
    fixture.port.send(coldCommand(sources));
    await flushTasks();
    fixture.port.send(command('grant'));
    await flushTasks();
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    work.resolve(coldReceipt(sources));
    await flushTasks();
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.port.statuses().some(status => status.type === 'coldCompleted')).toBe(false);
  });

  it('does no work before the grant and holds the reservation through the terminal until native exit', async () => {
    const fixture = createFixture();
    expect(fixture.port.statuses().map(status => status.type)).toEqual(['ready']);
    await prepare(fixture);
    expect(fixture.loadOperation).not.toHaveBeenCalled();
    expect(fixture.run).not.toHaveBeenCalled();
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.run).toHaveBeenCalledOnce();
    const [input, control] = fixture.run.mock.calls[0]!;
    expect(input).toEqual({ kind: 'inspect', migrationPolicy: 'restoreCompatible', operationId, stagingRoot: resolve('private-inspection-staging'),
      inspectionRoot: resolve('private-inspection-staging', `profile-inspection-${generationId}`),
      migrationsDirectory: resolve('private-backend', 'migrations'), nativeResourceRoot: resolve('private-native') });
    expect(input).not.toHaveProperty('runtimeSession');
    expect(input).not.toHaveProperty('databaseFilePath');
    expect(control.signal.aborted).toBe(false);
    expect(fixture.port.statuses().map(status => status.type)).toEqual(['ready', 'reservationReady', 'completed']);
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(0);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['exactCurrentManifest', 'compatibleHistoricalPrefix'] as const)
    ('forwards %s and refuses a weaker completed receipt', async migrationPolicy => {
      const fixture = createFixture();
      fixture.port.send({ ...prepareCommand(), migrationPolicy });
      await flushTasks();
      fixture.port.send(command('grant'));
      await flushTasks();
      expect(fixture.run.mock.calls[0]?.[0]).toHaveProperty('migrationPolicy', migrationPolicy);
      expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
      expect(fixture.port.statuses().some(status => status.type === 'completed')).toBe(false);
      fixture.port.send(command('shutdown'));
      expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    });

  it.each(['unprepared', 'ungranted'] as const)('does not reset the original work deadline at %s preparation', async state => {
    const fixture = createFixture();
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds - 1);
    if (state === 'ungranted') await prepare(fixture);
    expect(fixture.exit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['known', 'unknown'] as const)('retains only the first safe %s work cause', async classification => {
    const cause = classification === 'known'
      ? new Error('private work detail', { cause: new Error('PROFILE_SCHEMA_UNSUPPORTED') })
      : new AggregateError([new Error('private first detail'), new Error('PROFILE_SCHEMA_UNSUPPORTED')]);
    const fixture = createFixture({ loadOperation: async (_deployment, beginLoad) => {
      beginLoad(); return async () => { throw cause; };
    } });
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed',
      causeCode: classification === 'known' ? 'PROFILE_SCHEMA_UNSUPPORTED' : 'unknown' });
    expect(JSON.stringify(fixture.port.posted)).not.toContain('private work detail');
    expect(JSON.stringify(fixture.port.posted)).not.toContain('private first detail');
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(['memoryFirst', 'memoryOnlyDuringClose'] as const)('preserves cause order and publishes no native details: %s', async ordering => {
    const memory = new Error('PROFILE_INSPECTION_LIMIT_EXCEEDED', {
      cause: Object.assign(new Error('synthetic private native allocation detail'), { code: 'SQLITE_NOMEM' }),
    });
    const primary = new Error('PROFILE_SCHEMA_UNSUPPORTED');
    const close = new Error('synthetic private close detail');
    const failure = new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED', {
      cause: new AggregateError(ordering === 'memoryFirst' ? [memory, close] : [primary, memory],
        'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED'),
    });
    const fixture = createFixture({ loadOperation: async (_deployment, beginLoad) => {
      beginLoad(); return async () => { throw failure; };
    } });
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.port.statuses().at(-1)).toEqual({ ...identity, type: 'failed',
      causeCode: ordering === 'memoryFirst' ? 'PROFILE_INSPECTION_LIMIT_EXCEEDED' : 'PROFILE_SCHEMA_UNSUPPORTED' });
    expect(JSON.stringify(fixture.port.posted)).not.toMatch(/synthetic private|SQLITE_NOMEM|stack/);
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['generationId', 'operationId', 'runtimeSession'] as const)('rejects a stale %s before loading work', async field => {
    const fixture = createFixture();
    await prepare(fixture);
    fixture.port.send({ ...command('grant'), [field]: field === 'runtimeSession'
      ? 'z'.repeat(43) : 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee' });
    await flushTasks();
    expect(fixture.loadOperation).not.toHaveBeenCalled();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
  });

  it('rejects a duplicate preparation without acquiring or delivering twice', async () => {
    const fixture = createFixture();
    await prepare(fixture);
    fixture.port.send(prepareCommand());
    await flushTasks();
    expect(fixture.acquireReservation).toHaveBeenCalledOnce();
    expect(fixture.port.statuses().filter(status => status.type === 'failed')).toHaveLength(1);
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('cannot turn a malformed or duplicate post-terminal grant into success', async () => {
    const fixture = createFixture();
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    fixture.port.send({ ...command('grant'), extra: 'private detail' });
    await flushTasks();
    expect(fixture.run).toHaveBeenCalledOnce();
    expect(fixture.port.statuses().filter(status => status.type === 'completed')).toHaveLength(1);
    expect(fixture.port.statuses().filter(status => status.type === 'failed')).toHaveLength(0);
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
  });

  it.each(['wrongIdentity', 'invalidated', 'assertRejected'] as const)('never loads SQLite work after %s ownership', async cause => {
    const fixture = createFixture();
    if (cause === 'wrongIdentity') Object.assign(fixture.reservation, { identity: 'f'.repeat(64) });
    if (cause === 'invalidated') fixture.invalidation.abort();
    if (cause === 'assertRejected') fixture.reservation.assertOwned = vi.fn(async () => { throw new Error('private lost owner'); });
    await prepare(fixture);
    if (cause === 'assertRejected') {
      fixture.port.send(command('grant'));
      await flushTasks();
      fixture.port.send(command('shutdown'));
    }
    expect(fixture.loadOperation).not.toHaveBeenCalled();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
  });

  it.each(['shutdown', 'ownershipLost'] as const)('never invokes a late-loaded operation after %s', async cause => {
    const loaded = deferred<Awaited<ReturnType<RunnerOptions['loadOperation']>>>();
    const fixture = createFixture({ loadOperation: async (_deployment, beginLoad) => { beginLoad(); return loaded.promise; } });
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    if (cause === 'shutdown') fixture.port.send(command('shutdown'));
    else fixture.invalidation.abort();
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    loaded.resolve(fixture.run);
    await flushTasks();
    expect(fixture.run).not.toHaveBeenCalled();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed' });
  });

  it.each(['shutdown', 'timeout'] as const)('does not claim exit while %s work still owns handles', async cause => {
    const work = deferred<ProfileInspectionReceipt>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({ loadOperation: async (_deployment, beginLoad) => {
      beginLoad(); return async (_input, control) => { signal = control.signal; return work.promise; };
    } });
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    if (cause === 'shutdown') fixture.port.send(command('shutdown'));
    else await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(signal?.aborted).toBe(true);
    expect(fixture.exit).not.toHaveBeenCalled();
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    work.resolve(receipt());
    await flushTasks();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_TIMEOUT' });
    expect(fixture.port.statuses().filter(status => status.type === 'completed')).toHaveLength(0);
  });

  it('cancels delayed acquisition and never claims success from its late reservation', async () => {
    const acquired = deferred<WorkspaceProcessReservation>();
    let signal: AbortSignal | undefined;
    const fixture = createFixture({ acquireReservation: async input => { signal = input.signal; return acquired.promise; } });
    fixture.port.send(prepareCommand());
    await vi.advanceTimersByTimeAsync(profileInspectionWorkMilliseconds);
    expect(signal?.aborted).toBe(true);
    expect(fixture.exit).not.toHaveBeenCalled();
    acquired.resolve(fixture.reservation);
    await flushTasks();
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.loadOperation).not.toHaveBeenCalled();
    expect(fixture.reservation.release).not.toHaveBeenCalled();
  });

  it.each(['ready', 'reservationReady', 'completed'] as const)('exits safely if %s cannot be delivered', async statusType => {
    const fixture = createFixture({}, statusType);
    if (statusType !== 'ready') {
      await prepare(fixture);
      if (statusType === 'completed') { fixture.port.send(command('grant')); await flushTasks(); }
    }
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
    expect(fixture.reservation.release).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    if (statusType !== 'completed') expect(fixture.run).not.toHaveBeenCalled();
  });

  it('rejects a loader that never acknowledges the fixed module load boundary', async () => {
    const fixture = createFixture({ loadOperation: async () => async () => receipt() });
    await prepare(fixture);
    fixture.port.send(command('grant'));
    await flushTasks();
    expect(fixture.port.statuses().at(-1)).toMatchObject({ type: 'failed', causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID' });
    fixture.port.send(command('shutdown'));
    expect(fixture.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});

type RunnerOptions = Parameters<typeof startProfileInspectionRunner>[0];

function createFixture(overrides: Partial<Pick<RunnerOptions, 'loadOperation' | 'acquireReservation'>> = {}, brokenType?: string) {
  const port = new FakePort(brokenType);
  const invalidation = new AbortController();
  const reservation: WorkspaceProcessReservation = { identity: reservationIdentity,
    invalidated: invalidation.signal, assertOwned: vi.fn(async () => {}), release: vi.fn(async () => {}) };
  const run = vi.fn<Awaited<ReturnType<RunnerOptions['loadOperation']>>>(async () => receipt());
  const loadOperation = vi.fn<RunnerOptions['loadOperation']>(overrides.loadOperation ?? (async (_deployment, beginLoad) => {
    beginLoad(); return run;
  }));
  const acquireReservation = vi.fn<RunnerOptions['acquireReservation']>(overrides.acquireReservation ?? (async () => reservation));
  const exit = vi.fn();
  startProfileInspectionRunner({ parentPort: port, acquireReservation, loadOperation, exit });
  return { port, invalidation, reservation, run, loadOperation, acquireReservation, exit };
}

function prepareCommand(): ProfileInspectionCommand {
  return createProfileInspectionCommand({ ...identity, type: 'prepare', kind: 'inspect',
    migrationPolicy: 'restoreCompatible',
    deployment: { backendRoot: resolve('private-backend'), migrationsDirectory: resolve('private-backend', 'migrations'),
      nativeResourceRoot: resolve('private-native') },
    reservation: { generationId, identity: reservationIdentity, userDataRoot: resolve('private-inspection-staging', operationId) } });
}

function command(type: 'grant' | 'shutdown'): ProfileInspectionCommand {
  return createProfileInspectionCommand({ ...identity, type });
}

function coldCommand(sources: ProfileInspectionColdSources): ProfileInspectionCommand {
  const preparation = prepareCommand();
  if (preparation.type !== 'prepare' || preparation.kind !== 'inspect') throw new Error('EXPECTED_PORTABLE_PREPARATION');
  const { migrationPolicy: _policy, ...bound } = preparation;
  return createProfileInspectionCommand({ ...bound, kind: 'inspectColdRestoreContent', sources });
}

function originalCommand(sources: ProfileInspectionOriginalSources): ProfileInspectionCommand {
  const preparation = prepareCommand();
  if (preparation.type !== 'prepare' || preparation.kind !== 'inspect') throw new Error('EXPECTED_PORTABLE_PREPARATION');
  const { migrationPolicy: _policy, ...bound } = preparation;
  return createProfileInspectionCommand({ ...bound, kind: 'inspectColdRestoreOriginal', sources });
}

function originalReceipt(sources: ProfileInspectionOriginalSources): OriginalProfileInspectionReceipt {
  const original = { sourceRole: 'original' as const, layout: sources.layout, documentsSlot: sources.documentsSlot };
  if (sources.databaseSlot === 'absent') return { ...original, databaseSlot: 'absent' };
  const { artifactCatalog: _catalog, ...content } = receipt();
  return { ...original, ...content, migrationPolicy: 'restoreCompatible', databaseSlot: sources.databaseSlot,
    documentBindings: { byteSize: 34, sha256: 'b'.repeat(64) } };
}

function coldReceipt(sources: Pick<ProfileInspectionColdSources, 'databaseSlot' | 'documentsSlot'>): ColdProfileInspectionReceipt {
  const { artifactCatalog: _catalog, ...content } = receipt();
  return { ...content, documentBindings: { byteSize: 34, sha256: 'b'.repeat(64) },
    migrationPolicy: 'restoreCompatible', databaseSlot: sources.databaseSlot, documentsSlot: sources.documentsSlot };
}

async function prepare(fixture: ReturnType<typeof createFixture>): Promise<void> {
  fixture.port.send(prepareCommand());
  await flushTasks();
}

function receipt(): ProfileInspectionReceipt {
  return { artifactCount: 0, artifactIdentity: 'c'.repeat(64), artifactTotalByteSize: 0, databaseHealth: 'healthy', migrationChainIdentity: 'e'.repeat(64),
    profileId: 'f'.repeat(64), migrationPolicy: 'restoreCompatible',
    database: { byteSize: 4096, sha256: 'a'.repeat(64) }, artifactCatalog: { byteSize: 34, sha256: 'b'.repeat(64) } };
}

class FakePort implements ProfileInspectionRunnerPort {
  readonly posted: unknown[] = [];
  private listener: ((event: { readonly data: unknown }) => void) | undefined;
  constructor(private readonly brokenType?: string) {}
  on(_event: 'message', listener: (event: { readonly data: unknown }) => void): void { this.listener = listener; }
  postMessage(value: unknown): void {
    if (parseProfileInspectionStatus(value)?.type === this.brokenType) throw new Error('private disconnected channel');
    this.posted.push(value);
  }
  send(data: unknown): void { this.listener?.({ data }); }
  statuses() { return this.posted.map(parseProfileInspectionStatus).filter(status => status !== undefined); }
}

function deferred<T>() {
  let complete!: (value: T) => void;
  return { promise: new Promise<T>(resolveTask => { complete = resolveTask; }), resolve: (value: T) => complete(value) };
}

async function flushTasks(): Promise<void> { for (let index = 0; index < 24; index += 1) await Promise.resolve(); }
