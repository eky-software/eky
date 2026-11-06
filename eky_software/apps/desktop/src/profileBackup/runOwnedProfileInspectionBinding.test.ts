import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi, type TestContext } from 'vitest';

import { readProfileInspectionFailureCause } from '../runtime/profileInspectionFailure.js';
import { resolveProfileInspectionCopyRoot, type ProfileInspectionRequestIdentity } from '../runtime/profileInspectionMessages.js';
import { ProfileInspectionProcessError } from '../runtime/profileInspectionProcess.js';
import { createWorkspaceProcessReservationIdentity, type WorkspaceProcessReservationTransfer } from '../runtime/workspaceProcessReservation.js';
import { parseWorkspaceRemnantBinding } from '../workspaces/deletion/workspaceRemnantBindingCodec.js';
import { createWorkspaceRemnantBindingPaths } from '../workspaces/deletion/workspaceRemnantBindingPaths.js';
import { WorkspaceRemnantBindingStore } from '../workspaces/deletion/workspaceRemnantBindingStore.js';
import { WorkspaceCandidateInspectionCopy } from '../workspaces/runtime/workspaceCandidateInspectionCopy.js';
import { captureOwnedProfileInspectionTarget, runOwnedProfileInspection } from './runOwnedProfileInspection.js';
import type { ProfileSnapshotInspectionReservation } from './runProfileSnapshotInspection.js';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const operationId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const workspaceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const profileId = 'c'.repeat(64);
const databaseBytes = Buffer.from('synthetic inspection payload, not a SQLite verification');
type RunInput = Parameters<typeof runOwnedProfileInspection<void, string, string>>[0];
type Publication = Awaited<ReturnType<WorkspaceRemnantBindingStore['publish']>>;

afterEach(() => { vi.restoreAllMocks(); });

describe('owned inspection binding with real copy and metadata files', () => {
  it.for([undefined, null])('rejects a missing target before preparation instead of selecting unbound (%s)', async (target, context) => {
    const f = await fixture(context);
    const prepare = vi.fn<RunInput['prepare']>();
    const error = await failure(f.start({ target: target as unknown as RunInput['target'], prepare }));
    expect(error.causeCode).toBe('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(prepare).not.toHaveBeenCalled();
    expect(f.events).not.toContain('bind');
    expect(f.beforeWrite).not.toHaveBeenCalled();
    expect(await readdir(f.installationRoot)).toEqual([]);
  });

  it('publishes the actual copy identities before child writes and clears only after modeled exit and reclaim', async context => {
    const f = await fixture(context);
    const entered = deferred();
    const exit = deferred();
    let observed: ReturnType<typeof parseWorkspaceRemnantBinding> | undefined;
    let actualRootIdentity: string | undefined;
    let actualParentIdentity: string | undefined;
    let emptyBeforeWrite: string[] | undefined;
    f.beforeWrite.mockImplementation(async () => {
      observed = parseWorkspaceRemnantBinding(await readFile(f.paths().currentPath));
      actualRootIdentity = createWorkspaceProcessReservationIdentity(await lstat(f.copyRoot(), { bigint: true }));
      actualParentIdentity = createWorkspaceProcessReservationIdentity(await lstat(dirname(f.copyRoot()), { bigint: true }));
      emptyBeforeWrite = await readdir(f.copyRoot());
    });
    f.afterWrite.mockImplementation(async () => { entered.resolve(); await exit.promise; });
    const task = f.start();
    try {
      await Promise.race([entered.promise, task]);
      expect(observed).toEqual({ formatVersion: 1, owner: 'profileInspection', operationId,
        generationId: f.generationId(), workspaceId, lineageIdentity: { formatVersion: 1, profileId },
        rootIdentity: actualRootIdentity, parentIdentity: actualParentIdentity });
      expect(emptyBeforeWrite).toEqual([]);
      expect(f.installationRoot).not.toBe(f.reservationRoot);
      expect(await readFile(join(f.copyRoot(), 'profile.sqlite'))).toEqual(databaseBytes);
      expect(f.preparationOwned).toHaveBeenCalled();
      expect(f.reclaim).not.toHaveBeenCalled();
      expect(f.accept).not.toHaveBeenCalled();
    } finally { exit.resolve(); await Promise.allSettled([task]); }
    await expect(task).resolves.toBe('accepted');
    expect(f.events).toEqual(['bind', 'prepare', 'prepared', 'grant', 'write', 'exit', 'reclaim', 'accept']);
    expect(await f.snapshot()).toEqual({ current: undefined, next: undefined, backup: undefined });
    await expect(lstat(f.copyRoot())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.invalidate).not.toHaveBeenCalled();
  });

  it('keeps explicitly unbound inspection on the copy path without creating binding metadata', async context => {
    const f = await fixture(context);
    const publish = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish');
    const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent');
    await expect(f.start({ target: { kind: 'unbound' } })).resolves.toBe('accepted');
    expect(f.beforeWrite).toHaveBeenCalledOnce();
    expect(f.afterWrite).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
    expect(f.assertSelectionCurrent).not.toHaveBeenCalled();
    expect(await readdir(f.installationRoot)).toEqual([]);
    await expect(lstat(f.copyRoot())).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('retains the empty copy and every binding slot after a lost publish acknowledgement despite modeled reclaim', async context => {
    const f = await fixture(context);
    const original = WorkspaceRemnantBindingStore.prototype.publish;
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    const publish = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, authority) {
      await original.call(this, value, authority);
      const bytes = await readFile(f.paths().currentPath);
      await writeFile(f.paths().nextPath, bytes, { flag: 'wx', mode: 0o600 });
      await writeFile(f.paths().backupPath, bytes, { flag: 'wx', mode: 0o600 });
      before = await f.snapshot();
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    });
    const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent');
    const error = await failure(f.start());
    expect(error).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false, forced: false } });
    expect(before?.current).toBeInstanceOf(Buffer);
    expect(before?.next).toEqual(before?.current);
    expect(before?.backup).toEqual(before?.current);
    expect(await f.snapshot()).toEqual(before);
    expect(await readdir(f.copyRoot())).toEqual([]);
    expect(f.events).toEqual(['bind', 'prepare', 'exit', 'reclaim', 'invalidate']);
    expect(publish).toHaveBeenCalledOnce();
    expect(clear).not.toHaveBeenCalled();
    expect(f.beforeWrite).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('awaits the raw publish task before modeled reclaim and never grants cancelled late publication', async context => {
    const f = await fixture(context);
    const published = deferred();
    const acknowledgement = deferred();
    const original = WorkspaceRemnantBindingStore.prototype.publish;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, authority) {
      const receipt = await original.call(this, value, authority);
      published.resolve();
      await acknowledgement.promise;
      return receipt;
    });
    let settled = false;
    const outcome = failure(f.start()).finally(() => { settled = true; });
    try {
      await Promise.race([published.promise, outcome]);
      const before = await f.snapshot();
      f.cancellation.abort();
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(f.reclaim).not.toHaveBeenCalled();
      expect(f.invalidate).not.toHaveBeenCalled();
      expect(f.beforeWrite).not.toHaveBeenCalled();
      expect(await readdir(f.copyRoot())).toEqual([]);
      expect(await f.snapshot()).toEqual(before);
    } finally { acknowledgement.resolve(); await Promise.allSettled([outcome]); }
    expect(await outcome).toHaveProperty('causeCode', 'PROFILE_INSPECTION_TIMEOUT');
    expect(f.reclaim).toHaveBeenCalledOnce();
    expect(f.events).not.toContain('grant');
    expect(f.afterWrite).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('preserves bound evidence and the first process cause when selection is revoked before cleanup', async context => {
    const f = await fixture(context);
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    f.afterWrite.mockImplementation(async () => {
      before = await f.snapshot();
      f.revokeSelection();
      throw new Error('PROFILE_SCHEMA_UNSUPPORTED');
    });
    const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent');
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(before?.current).toBeInstanceOf(Buffer);
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(f.copyRoot(), 'profile.sqlite'))).toEqual(databaseBytes);
    expect(clear).not.toHaveBeenCalled();
    expect(f.reclaim).toHaveBeenCalledOnce();
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('cleans an acknowledged binding after an ordinary process failure without replacing its first cause', async context => {
    const f = await fixture(context);
    f.afterWrite.mockRejectedValueOnce(new Error('PROFILE_SCHEMA_UNSUPPORTED'));
    const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent');
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_SCHEMA_UNSUPPORTED',
      cleanup: { processAbsent: true, reservationReclaimed: true, forced: false } });
    expect(f.reclaim).toHaveBeenCalledOnce();
    expect(clear).toHaveBeenCalledOnce();
    expect(await f.snapshot()).toEqual({ current: undefined, next: undefined, backup: undefined });
    await expect(lstat(f.copyRoot())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.invalidate).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('rejects selection loss after physical grant validation before the child can write', async context => {
    const f = await fixture(context);
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    f.beforeGrant.mockImplementation(async () => { before = await f.snapshot(); f.revokeSelection(); });
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_PROTOCOL_INVALID',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(before?.current).toBeInstanceOf(Buffer);
    expect(await f.snapshot()).toEqual(before);
    expect(await readdir(f.copyRoot())).toEqual([]);
    expect(f.beforeWrite).not.toHaveBeenCalled();
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('retains copy bytes and binding when selection is lost inside copy cleanup', async context => {
    const f = await fixture(context);
    const discard = WorkspaceCandidateInspectionCopy.prototype.discardAfterExit;
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    vi.spyOn(WorkspaceCandidateInspectionCopy.prototype, 'discardAfterExit').mockImplementation(async function (
      this: WorkspaceCandidateInspectionCopy, assertOwned, signal, requireEmpty,
    ) {
      before = await f.snapshot();
      f.revokeSelection();
      return discard.call(this, assertOwned, signal, requireEmpty);
    });
    expect(await failure(f.start())).toMatchObject({ cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(await readFile(join(f.copyRoot(), 'profile.sqlite'))).toEqual(databaseBytes);
    expect(await f.snapshot()).toEqual(before);
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('captures mutable target fields and the validator before asynchronous preparation', async context => {
    const f = await fixture(context);
    const captured = captureOwnedProfileInspectionTarget(f.target);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(captured.kind).toBe('bound');
    if (captured.kind !== 'bound') throw new Error('EXPECTED_BOUND_TARGET');
    expect(Object.isFrozen(captured.lineageIdentity)).toBe(true);
    let observed: ReturnType<typeof parseWorkspaceRemnantBinding> | undefined;
    const replacementValidator = vi.fn(async () => { throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); });
    f.beforeWrite.mockImplementation(async () => {
      observed = parseWorkspaceRemnantBinding(await readFile(f.paths().currentPath));
    });
    await expect(f.start({ prepare: async control => {
      await control.assertMainOwned();
      f.target.workspaceId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
      f.target.lineageIdentity.profileId = 'e'.repeat(64);
      f.target.installationRoot = join(f.root, 'not-the-selected-installation');
      f.target.assertSelectionCurrent = replacementValidator;
    } })).resolves.toBe('accepted');
    expect(observed).toMatchObject({ workspaceId, lineageIdentity: { formatVersion: 1, profileId } });
    expect(captured.lineageIdentity.profileId).toBe(profileId);
    expect(f.assertSelectionCurrent).toHaveBeenCalled();
    expect(replacementValidator).not.toHaveBeenCalled();
    await expect(lstat(f.target.installationRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await f.snapshot()).toEqual({ current: undefined, next: undefined, backup: undefined });
  });

  it('does not clear metadata or retry copy cleanup when an unexpected payload prevents removal', async context => {
    const f = await fixture(context);
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    f.afterWrite.mockImplementation(async () => {
      await writeFile(join(f.copyRoot(), 'foreign.txt'), 'retain unknown payload', { flag: 'wx' });
      before = await f.snapshot();
    });
    const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent');
    const discard = vi.spyOn(WorkspaceCandidateInspectionCopy.prototype, 'discardAfterExit');
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(before?.current).toBeInstanceOf(Buffer);
    expect(await f.snapshot()).toEqual(before);
    expect(await readFile(join(f.copyRoot(), 'profile.sqlite'))).toEqual(databaseBytes);
    expect(await readFile(join(f.copyRoot(), 'foreign.txt'), 'utf8')).toBe('retain unknown payload');
    expect(clear).not.toHaveBeenCalled();
    expect(discard).toHaveBeenCalledOnce();
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.accept).not.toHaveBeenCalled();
  });

  it('retains metadata without retry or acceptance when clearing fails after acknowledged copy removal', async context => {
    const f = await fixture(context);
    const original = WorkspaceRemnantBindingStore.prototype.publish;
    let receipt: Publication | undefined;
    let before: Awaited<ReturnType<typeof f.snapshot>> | undefined;
    vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'publish').mockImplementation(async function (this: WorkspaceRemnantBindingStore, value, authority) {
      receipt = await original.call(this, value, authority);
      before = await f.snapshot();
      return receipt;
    });
    let copyAbsentAtClear = false;
    const clear = vi.spyOn(WorkspaceRemnantBindingStore.prototype, 'clearAfterPayloadsAbsent')
      .mockImplementation(async (_binding, proof) => {
        await proof.assertPayloadsAbsent();
        copyAbsentAtClear = await absent(f.copyRoot());
        throw new Error('SYNTHETIC_METADATA_CLEAR_FAILED');
      });
    expect(await failure(f.start())).toMatchObject({ causeCode: 'PROFILE_INSPECTION_CLEANUP_UNVERIFIED',
      cleanup: { processAbsent: true, reservationReclaimed: false } });
    expect(copyAbsentAtClear).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
    expect(clear.mock.calls[0]![0]).toEqual(receipt?.value);
    expect(clear.mock.calls[0]![1]).toMatchObject({ mode: 'owner', bindingSha256: receipt?.bindingSha256,
      expectedCurrentIdentity: receipt?.identity });
    expect(before?.current).toBeInstanceOf(Buffer);
    expect(await f.snapshot()).toEqual(before);
    await expect(lstat(f.copyRoot())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(f.invalidate).toHaveBeenCalledOnce();
    expect(f.accept).not.toHaveBeenCalled();
  });
});

async function fixture(context: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'eky-owned-inspection-binding-'));
  await chmod(root, 0o700);
  let pending = 0;
  context.onTestFinished(async () => {
    if (context.task.result?.state === 'pass' && pending === 0) await rm(root, { recursive: true, force: true });
  });
  const installationRoot = join(root, 'installation');
  const stagingRoot = join(root, 'staging');
  const reservationRoot = join(stagingRoot, 'reservation');
  for (const directory of [installationRoot, stagingRoot, reservationRoot]) await mkdir(directory, { mode: 0o700 });
  const reservationIdentity = createWorkspaceProcessReservationIdentity(await lstat(reservationRoot, { bigint: true }));
  const events: string[] = [];
  let phase: 'main' | 'bound' | 'preparing' | 'prepared' | 'authorized' | 'granted' | 'closing' | 'exited' | 'invalid' = 'main';
  let selected = true;
  let transfer: WorkspaceProcessReservationTransfer | undefined;
  const cancellation = new AbortController();
  const assertAuthority = vi.fn(() => {});
  const assertSelectionCurrent = vi.fn(async (assertPhaseCurrent: () => void) => {
    assertPhaseCurrent();
    if (!selected) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    await Promise.resolve();
    assertPhaseCurrent();
    if (!selected) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });
  const target = { kind: 'bound' as const, installationRoot, workspaceId,
    lineageIdentity: { formatVersion: 1 as const, profileId },
    assertSelectionCurrent: (assertPhaseCurrent: () => void) => assertSelectionCurrent(assertPhaseCurrent) };
  const invalidate = vi.fn(() => { events.push('invalidate'); phase = 'invalid'; });
  const assertMainOwned = vi.fn(async () => {
    if (phase !== 'main') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });
  const preparationOwned = vi.fn(async (assertPreparationCurrent: () => void) => {
    assertPreparationCurrent();
    await Promise.resolve();
    assertPreparationCurrent();
  });
  const beforeGrant = vi.fn(async () => {});
  const reclaim = vi.fn(async (signal: AbortSignal) => {
    if (phase !== 'exited' || signal.aborted) throw new Error('PROFILE_INSPECTION_CLEANUP_UNVERIFIED');
    events.push('reclaim'); phase = 'main';
  });
  const reservation: ProfileSnapshotInspectionReservation = {
    assertMainOwned, invalidate,
    bind(generationId, assertCurrent, prepareMainOwned) {
      if (phase !== 'main') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      events.push('bind'); phase = 'bound';
      transfer = {
        descriptor: { generationId, identity: reservationIdentity, userDataRoot: reservationRoot },
        async prepare(signal) {
          if (phase !== 'bound') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
          phase = 'preparing'; events.push('prepare');
          const assertPreparationCurrent = () => {
            if (phase !== 'preparing' || signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
            assertCurrent();
          };
          try {
            await prepareMainOwned(signal, assertPreparationCurrent, () => preparationOwned(assertPreparationCurrent));
            assertPreparationCurrent();
            phase = 'prepared'; events.push('prepared');
          } catch (error) { phase = 'closing'; throw error; }
        },
        async assertGrant(signal) {
          if (phase !== 'prepared' || signal.aborted) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
          assertCurrent();
          await beforeGrant();
          assertCurrent(); phase = 'authorized';
        },
        assertCurrent() {
          if (phase !== 'authorized') throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
          assertCurrent(); phase = 'granted'; events.push('grant');
        },
        reclaimAfterExit: reclaim, invalidate,
      };
      return transfer;
    },
  };
  const beforeWrite = vi.fn(async (_identity: ProfileInspectionRequestIdentity) => {});
  const afterWrite = vi.fn(async () => {});
  const copyRoot = () => {
    if (transfer === undefined) throw new Error('EXPECTED_INSPECTION_TRANSFER');
    return resolveProfileInspectionCopyRoot(transfer.descriptor);
  };
  const generationId = () => {
    if (transfer === undefined) throw new Error('EXPECTED_INSPECTION_TRANSFER');
    return transfer.descriptor.generationId;
  };
  const paths = () => createWorkspaceRemnantBindingPaths(installationRoot,
    { owner: 'profileInspection', operationId, generationId: generationId() });
  const snapshot = async () => {
    const current = paths();
    return { current: await optionalBytes(current.currentPath), next: await optionalBytes(current.nextPath),
      backup: await optionalBytes(current.backupPath) };
  };
  // Only file/copy/binding operations are real. Exit, reclaim and phase exclusion are modeled here.
  const inspect: RunInput['inspect'] = async (_preparation, input) => {
    try {
      await input.reservationTransfer.prepare(input.signal);
      await input.reservationTransfer.assertGrant(input.signal);
      input.reservationTransfer.assertCurrent();
      await beforeWrite(input.identity);
      await writeFile(join(copyRoot(), 'profile.sqlite'), databaseBytes, { flag: 'wx', mode: 0o600 });
      events.push('write');
      await afterWrite();
      return 'synthetic receipt';
    } catch (error) {
      throw new ProfileInspectionProcessError(readProfileInspectionFailureCause(error) ?? 'unknown',
        { processAbsent: true, reservationReclaimed: true, forced: false });
    } finally {
      phase = 'exited'; events.push('exit');
      await input.reservationTransfer.reclaimAfterExit(new AbortController().signal);
    }
  };
  const accept = vi.fn(async () => { events.push('accept'); return 'accepted'; });
  const prepare: RunInput['prepare'] = async control => { await control.assertMainOwned(); };
  return { root, installationRoot, reservationRoot, target, cancellation, events, preparationOwned,
    assertSelectionCurrent, beforeGrant, beforeWrite, afterWrite, reclaim, invalidate, accept, copyRoot, generationId, paths, snapshot,
    revokeSelection() { selected = false; },
    start(overrides: Partial<Pick<RunInput, 'target' | 'prepare'>> = {}) {
      pending += 1;
      return runOwnedProfileInspection({ operationId, target, reservation, assertAuthority,
        signal: cancellation.signal, prepare, inspect, accept, ...overrides }).finally(() => { pending -= 1; });
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => { resolve = complete; });
  return { promise, resolve };
}

async function optionalBytes(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

async function absent(path: string): Promise<boolean> {
  try { await lstat(path); return false; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}

async function failure(task: Promise<unknown>): Promise<ProfileInspectionProcessError> {
  try { await task; }
  catch (error) {
    expect(error).toBeInstanceOf(ProfileInspectionProcessError);
    return error as ProfileInspectionProcessError;
  }
  throw new Error('EXPECTED_INSPECTION_FAILURE');
}
