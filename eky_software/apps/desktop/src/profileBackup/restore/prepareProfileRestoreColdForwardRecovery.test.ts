import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { acquireWorkspaceProcessReservation } from '../../runtime/workspaceProcessReservation.js';
import { InMemoryWorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import type { ProfileRecoveryOperationalEvent } from '../profileRecoveryOperationalObserver.js';
import { prepareProfileRestoreColdForwardRecovery } from './prepareProfileRestoreColdForwardRecovery.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

describe('cold forward restore admission', () => {
  it('holds the exact operation and installation lease across recovery, then releases before returning', async () => {
    const fixture = await createFixture();
    const order: string[] = [];
    fixture.reservation.close.mockImplementation(async () => { order.push('close'); });
    fixture.recovery.prepareBeforeBackend.mockImplementation(async admission => {
      order.push('prepare');
      expect(fixture.lease.readState()).toBe('busy');
      expect(admission!.journal).toEqual(fixture.journal);
      expect(Object.isFrozen(admission!.journal)).toBe(true);
      await admission!.assertCurrent();
      return 'validateRestoredProfile';
    });
    await expect(prepareProfileRestoreColdForwardRecovery(fixture.input)).resolves.toBe('validateRestoredProfile');
    expect(fixture.acquire).toHaveBeenCalledExactlyOnceWith(join(fixture.root, fixture.journal.operationId));
    expect(order).toEqual(['prepare', 'close']);
    expect(fixture.lease.readState()).toBe('idle');
  });

  it('rejects an already held maintenance lease without taking another reservation', async () => {
    const fixture = await createFixture();
    const other = await fixture.lease.acquire('backup');
    try {
      await expect(prepareProfileRestoreColdForwardRecovery(fixture.input)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(fixture.acquire).not.toHaveBeenCalled();
      expect(fixture.recovery.prepareBeforeBackend).not.toHaveBeenCalled();
      expect(fixture.lease.readState()).toBe('busy');
    } finally { await other.release(); }
  });

  it.each(['beforeClaim', 'afterClaim'] as const)('rejects a changed journal at %s without repairing it', async stage => {
    const fixture = await createFixture();
    const foreign = { ...fixture.journal, operationId: randomUUID() };
    if (stage === 'beforeClaim') fixture.peek.mockResolvedValue(foreign);
    else fixture.acquire.mockImplementation(async () => {
      fixture.peek.mockResolvedValue(foreign);
      return fixture.reservation;
    });
    await expect(prepareProfileRestoreColdForwardRecovery(fixture.input)).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      cause: { message: 'PROFILE_RESTORE_ACTIVATION_STATE_INVALID' },
    });
    expect(fixture.recovery.prepareBeforeBackend).not.toHaveBeenCalled();
    expect(fixture.reservation.close).toHaveBeenCalledTimes(stage === 'beforeClaim' ? 0 : 1);
    expect(fixture.lease.readState()).toBe('idle');
    await expect(readFile(fixture.evidence)).resolves.toEqual(fixture.bytes);
  });

  it('checks main ownership freshly after acquiring the operation reservation', async () => {
    const fixture = await createFixture();
    const primary = new Error('synthetic changed main');
    fixture.acquire.mockImplementation(async () => {
      fixture.assertMainOwned.mockRejectedValue(primary);
      return fixture.reservation;
    });
    await expect(prepareProfileRestoreColdForwardRecovery(fixture.input)).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: primary,
    });
    expect(fixture.recovery.prepareBeforeBackend).not.toHaveBeenCalled();
    expect(fixture.reservation.close).toHaveBeenCalledOnce();
    expect(fixture.lease.readState()).toBe('idle');
  });

  it('retains the first preparation failure separately from close and lease-release failures', async () => {
    const fixture = await createFixture();
    const primary = new Error('synthetic forward failure');
    const closeFailure = new Error('synthetic close failure');
    const releaseFailure = new Error('synthetic release failure');
    const acquireLease = fixture.lease.acquire.bind(fixture.lease);
    const released = vi.fn(async () => { throw releaseFailure; });
    vi.spyOn(fixture.lease, 'acquire').mockImplementation(async purpose => {
      const held = await acquireLease(purpose);
      return { release: async () => { await held.release(); await released(); } };
    });
    fixture.recovery.prepareBeforeBackend.mockRejectedValue(primary);
    fixture.reservation.close.mockRejectedValue(closeFailure);
    await expect(prepareProfileRestoreColdForwardRecovery(fixture.input)).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED',
      cause: { errors: [primary, closeFailure, releaseFailure] },
    });
    expect(fixture.reservation.close).toHaveBeenCalledOnce();
    expect(released).toHaveBeenCalledOnce();
    await expect(readFile(fixture.evidence)).resolves.toEqual(fixture.bytes);
  });

  it('does not report successful admission if reservation close fails', async () => {
    const fixture = await createFixture();
    const closeFailure = new Error('synthetic close failure');
    fixture.reservation.close.mockRejectedValue(closeFailure);
    await expect(prepareProfileRestoreColdForwardRecovery(fixture.input)).rejects.toMatchObject({
      message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: closeFailure,
    });
    expect(fixture.lease.readState()).toBe('idle');
    expect(fixture.events).toEqual([expect.objectContaining({
      eventName: 'restore.recoveryRequired', stage: 'startupRollback',
    })]);
    expect(JSON.stringify(fixture.events)).not.toContain(closeFailure.message);
    expect(JSON.stringify(fixture.events)).not.toContain(fixture.root);
  });

  it.each(['accepted', 'rollbackStarting', 'rolledBack', 'failedSafe'] as const)(
    'does not claim terminal %s under forward admission', async phase => {
      const fixture = await createFixture();
      await expect(prepareProfileRestoreColdForwardRecovery({
        ...fixture.input, journal: { ...fixture.journal, phase },
      })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(fixture.acquire).not.toHaveBeenCalled();
      expect(fixture.recovery.prepareBeforeBackend).not.toHaveBeenCalled();
      expect(fixture.lease.readState()).toBe('idle');
    },
  );

  it('uses real native exclusion and never recreates a missing operation root', async () => {
    const fixture = await createFixture();
    const operationRoot = join(fixture.root, fixture.journal.operationId);
    await mkdir(operationRoot);
    const nativeAcquire = async (userDataRoot: string) => {
      const held = await acquireWorkspaceProcessReservation({ userDataRoot, signal: new AbortController().signal });
      return { assertMainOwned: () => held.assertOwned(), close: () => held.release(),
        assertMainCurrent() { if (held.invalidated.aborted) throw new Error('synthetic owner lost'); },
        invalidate() {}, bind() { throw new Error('not used by this ownership fixture'); } };
    };
    const held = await nativeAcquire(operationRoot);
    const entries = await readdir(fixture.root);
    try {
      await expect(prepareProfileRestoreColdForwardRecovery({ ...fixture.input,
        acquireReservation: nativeAcquire,
      })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { reason: 'busy' } });
      expect(fixture.recovery.prepareBeforeBackend).not.toHaveBeenCalled();
      await held.assertMainOwned();
      await expect(readdir(fixture.root)).resolves.toEqual(entries);
    } finally { await held.close(); }
    await expect(prepareProfileRestoreColdForwardRecovery({ ...fixture.input,
      acquireReservation: nativeAcquire,
    })).resolves.toBe('validateRestoredProfile');
    const after = await nativeAcquire(operationRoot);
    await after.close();
    await rm(operationRoot, { recursive: true });
    fixture.recovery.prepareBeforeBackend.mockClear();
    await expect(prepareProfileRestoreColdForwardRecovery({ ...fixture.input,
      acquireReservation: nativeAcquire,
    })).rejects.toMatchObject({ message: 'PROFILE_RESTORE_RECOVERY_REQUIRED', cause: { reason: 'rootUnavailable' } });
    expect(fixture.recovery.prepareBeforeBackend).not.toHaveBeenCalled();
    await expect(readdir(fixture.root)).resolves.toEqual(['retained-evidence']);
    await expect(readFile(fixture.evidence)).resolves.toEqual(fixture.bytes);
  });
});

async function createFixture() {
  const root = await mkdtemp(join(tmpdir(), 'eky-cold-forward-'));
  roots.push(root);
  const journal: ProfileRestoreActivationJournal = {
    formatVersion: 1, operationId: randomUUID(), phase: 'prepared', revision: 0,
    hadActiveDatabase: true, hadActiveDocuments: true,
  };
  const evidence = join(root, 'retained-evidence');
  const bytes = Buffer.from('synthetic retained evidence');
  await writeFile(evidence, bytes);
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const reservation = { assertMainOwned: vi.fn(async () => {}), close: vi.fn(async () => {}),
    assertMainCurrent: vi.fn(() => {}), invalidate: vi.fn(() => {}),
    bind: vi.fn(() => { throw new Error('not used by this ownership fixture'); }) };
  const acquire = vi.fn(async (_root: string) => reservation);
  const peek = vi.fn(async () => journal);
  const assertMainOwned = vi.fn(async () => {});
  type Admission = NonNullable<Parameters<import('./profileRestoreStartupRecovery.js').ProfileRestoreStartupRecovery['prepareBeforeBackend']>[0]>;
  const recovery = { prepareBeforeBackend: vi.fn(async (_admission?: Admission) => 'validateRestoredProfile' as const) };
  const events: ProfileRecoveryOperationalEvent[] = [];
  const input = { journal, stagingRoot: root, maintenanceLease: lease, journalStore: { peek },
    acquireReservation: acquire, assertMainOwned, assertAuthority: vi.fn(() => {}),
    assertContent: vi.fn(async () => {}), recovery, observer: { observe: (event: ProfileRecoveryOperationalEvent) => { events.push(event); } } };
  return { root, journal, evidence, bytes, lease, reservation, acquire, peek, recovery, assertMainOwned, input, events };
}
