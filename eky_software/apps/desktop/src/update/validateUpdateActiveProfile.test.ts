import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ProfileSnapshotInspectionClient } from '../profileBackup/profileSnapshotInspectionClient.js';
import { profileInspectionShutdownMilliseconds, profileInspectionWorkMilliseconds,
  type ProfileInspectionReceipt } from '../runtime/profileInspectionMessages.js';
import { InMemoryWorkspaceMaintenanceLease } from '../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { UpdateActiveProfileValidationContext } from './updateActiveProfileValidation.js';
import { validateUpdateActiveProfile } from './validateUpdateActiveProfile.js';

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('borrowed update active profile validation', () => {
  it.each(['preparation', 'handoff'] as const)('uses the exact %s fence without reacquiring or releasing ownership', async stage => {
    const f = await fixture(stage);
    const acquire = vi.spyOn(f.lease, 'acquire');
    try {
      await expect(validateUpdateActiveProfile(f.input)).resolves.toEqual(f.metadata);
      const id = f.client.createProfileSnapshot.mock.calls[0]![0];
      expect(id === f.context.operationId).toBe(stage === 'handoff');
      expect(f.client.createProfileSnapshot).toHaveBeenCalledWith(id, 'exactCurrentManifest');
      if (stage === 'handoff') expect(f.client.validateProfileSnapshot).toHaveBeenCalledWith(id, id);
      else expect(f.client.validateProfileSnapshot).toHaveBeenCalledWith(id);
      expect(f.client.beginMaintenance).toHaveBeenCalledTimes(stage === 'preparation' ? 1 : 0);
      expect(f.client.endMaintenance).toHaveBeenCalledTimes(stage === 'preparation' ? 1 : 0);
      expect(f.events.at(-1)).toBe('confirmed');
      expect(f.client.removeProfileSnapshot).toHaveBeenCalledWith(id);
      expect(f.lease.readState()).toBe('busy');
      expect(acquire).not.toHaveBeenCalled();
    } finally { await f.release(); }
  });

  it.each(['missing', 'wrongPurpose', 'changed'] as const)('rejects a %s owner before work', async mode => {
    const f = await fixture();
    await f.release();
    const newOwner = mode === 'missing' ? undefined : await f.lease.acquire(mode === 'wrongPurpose' ? 'restore' : 'update');
    try {
      await expect(validateUpdateActiveProfile(f.input)).rejects.toThrow();
      expect(f.client.beginMaintenance).not.toHaveBeenCalled();
      expect(f.client.createProfileSnapshot).not.toHaveBeenCalled();
      expect(f.context.confirmCleanup).not.toHaveBeenCalled();
    } finally { await newOwner?.release(); }
  });

  it.each(['preparation', 'handoff'] as const)('can confirm a clean %s inspection refusal only after owned removal', async stage => {
    const f = await fixture(stage); const first = new Error('synthetic rejected schema');
    f.client.validateProfileSnapshot.mockRejectedValue(first);
    try {
      await expect(validateUpdateActiveProfile(f.input)).rejects.toBe(first);
      expect(f.client.removeProfileSnapshot).toHaveBeenCalledOnce();
      expect(f.events.at(-1)).toBe('confirmed');
      expect(f.lease.readState()).toBe('busy');
    } finally { await f.release(); }
  });

  it('independently rejects restore-purpose ownership despite a permissive caller context', async () => {
    const f = await fixture(); await f.release(); const wrong = await f.lease.acquire('restore');
    try {
      await expect(validateUpdateActiveProfile({ ...f.input,
        context: { ...f.context, assertCurrent: () => {} },
      })).rejects.toThrow('WORKSPACE_MAINTENANCE_BUSY');
      expect(f.client.createProfileSnapshot).not.toHaveBeenCalled();
      expect(f.context.confirmCleanup).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('busy');
    } finally { await wrong.release(); }
  });

  it.each(['artifactCount', 'artifactTotalByteSize', 'profileId', 'migrationPolicy', 'migrationChainIdentity', 'databaseHealth'] as const)(
    'rejects inconsistent receipt %s', async key => {
      const f = await fixture(); f.receipt[key] = (typeof f.receipt[key] === 'number' ? 99 : 'wrong') as never;
      try { await expect(validateUpdateActiveProfile(f.input)).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED'); }
      finally { await f.release(); }
    },
  );

  it.each(['create', 'inspectExit', 'remove', 'end', 'fenceLost'] as const)(
    'does not confirm uncertain %s and preserves the first failure', async failure => {
      const f = await fixture(failure === 'fenceLost' ? 'handoff' : 'preparation');
      const first = new Error('synthetic first refusal'); const cleanup = new Error('synthetic cleanup unverified');
      if (failure === 'create') f.client.createProfileSnapshot.mockRejectedValue(first);
      else f.client.validateProfileSnapshot.mockRejectedValue(first);
      if (failure === 'create' || failure === 'inspectExit' || failure === 'remove') f.client.removeProfileSnapshot.mockRejectedValue(cleanup);
      if (failure === 'end') f.client.endMaintenance.mockRejectedValue(cleanup);
      if (failure === 'fenceLost') f.client.assertUpdateMaintenance.mockResolvedValueOnce('busy').mockRejectedValue(cleanup);
      try {
        await expect(validateUpdateActiveProfile(f.input)).rejects.toMatchObject({ errors: [first, cleanup] });
        expect(f.context.confirmCleanup).not.toHaveBeenCalled();
        if (failure !== 'end') expect(f.client.endMaintenance).not.toHaveBeenCalled();
        expect(f.lease.readState()).toBe('busy');
      } finally { await f.release(); }
    },
  );

  it('does not remove under an owner replaced during inspection', async () => {
    const f = await fixture(); let replacement: { release(): Promise<void> } | undefined;
    f.hooks.inspect = async () => { await f.release(); replacement = await f.lease.acquire('update'); };
    try {
      await expect(validateUpdateActiveProfile(f.input)).rejects.toThrow();
      expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
      expect(f.client.endMaintenance).not.toHaveBeenCalled();
      expect(f.context.confirmCleanup).not.toHaveBeenCalled();
    } finally { await replacement?.release(); }
  });

  it.each(['inspect', 'remove'] as const)('retains the owner after bounded %s timeout and ignores late completion', async phase => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const f = await fixture(); const pending = deferred();
    f.hooks[phase] = () => pending.promise;
    const result = validateUpdateActiveProfile(f.input);
    const rejected = expect(result).rejects.toThrow();
    await (phase === 'inspect' ? f.inspectionStarted : f.removalStarted);
    await vi.advanceTimersByTimeAsync((phase === 'inspect' ? profileInspectionWorkMilliseconds : 0) +
      2 * profileInspectionShutdownMilliseconds);
    await rejected;
    expect(f.context.confirmCleanup).not.toHaveBeenCalled();
    expect(f.client.endMaintenance).not.toHaveBeenCalled();
    if (phase === 'inspect') expect(f.client.removeProfileSnapshot).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('busy');
    pending.resolve(); await vi.runAllTimersAsync();
    expect(f.context.confirmCleanup).not.toHaveBeenCalled();
    expect(f.client.endMaintenance).not.toHaveBeenCalled();
    await f.release();
  });
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(stage: UpdateActiveProfileValidationContext['stage'] = 'preparation') {
  const events: string[] = []; const lease = new InMemoryWorkspaceMaintenanceLease();
  const held = await lease.acquire('update'); const assertOwner = lease.captureCurrentOwner(['update']);
  const metadata = { artifactCount: 1, artifactTotalByteSize: 8, databaseHealth: 'healthy' as const, migrationChainIdentity: 'c'.repeat(64) };
  const receipt: { -readonly [K in keyof ProfileInspectionReceipt]: ProfileInspectionReceipt[K] } = {
    ...metadata, profileId: 'a'.repeat(64), migrationPolicy: 'exactCurrentManifest', artifactIdentity: 'e'.repeat(64),
    database: { byteSize: 4, sha256: 'd'.repeat(64) }, artifactCatalog: { byteSize: 4, sha256: 'b'.repeat(64) },
  };
  const hooks = { inspect: async () => {}, remove: async () => {} };
  const inspection = deferred(); const removal = deferred();
  const client = {
    async withInspectionOperation<T>(use: () => Promise<T>) { return use(); },
    beginMaintenance: vi.fn(async (_id: string) => { events.push('begin'); return 'busy' as const; }),
    endMaintenance: vi.fn(async (_id: string) => { events.push('end'); return 'normal' as const; }),
    assertUpdateMaintenance: vi.fn(async (_id: string) => { events.push('update'); return 'busy' as const; }),
    createProfileSnapshot: vi.fn<ProfileSnapshotInspectionClient['createProfileSnapshot']>(async () => ({
      type: 'profileSnapshot', database: { databaseByteSize: 4, logicalPath: 'profile.sqlite', sha256: 'd'.repeat(64), totalPages: 1 },
      artifactCatalog: { artifactCount: 1, artifactTotalByteSize: 8, catalogByteSize: 4, logicalPath: 'snapshot-catalog-v1.json', sha256: 'b'.repeat(64) },
    })),
    validateProfileSnapshot: vi.fn<ProfileSnapshotInspectionClient['validateProfileSnapshot']>(async () => {
      inspection.resolve(); await hooks.inspect();
      return { ...metadata, profileId: 'a'.repeat(64), type: 'profileSnapshotValidation', activeProfileIsEmpty: false, profileMatchesActive: true };
    }),
    async withProfileSnapshot<T>(_id: string, use: (receipt: ProfileInspectionReceipt, assertCurrent: () => Promise<void>) => Promise<T>) {
      return use(receipt, async () => {});
    },
    removeProfileSnapshot: vi.fn(async (_id: string) => { events.push('remove'); removal.resolve(); await hooks.remove(); }),
  };
  const context = Object.freeze({ operationId: '22222222-2222-4222-8222-222222222222', stage,
    assertCurrent: vi.fn(assertOwner), confirmCleanup: vi.fn(() => { events.push('confirmed'); }) });
  const input = { context, snapshotClient: client, maintenanceLease: lease, assertAuthority: () => {},
    assertLineage: (id: string) => { if (id !== 'a'.repeat(64)) throw new Error('synthetic lineage refusal'); } };
  return { input, context, client, receipt, metadata, lease, release: () => held.release(), events, hooks,
    inspectionStarted: inspection.promise, removalStarted: removal.promise };
}
