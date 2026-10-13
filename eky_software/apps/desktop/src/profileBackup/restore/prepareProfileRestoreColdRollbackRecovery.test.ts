import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import { InMemoryWorkspaceMaintenanceLease } from '../../workspaces/maintenance/workspaceMaintenanceLease.js';
import { prepareProfileRestoreColdRollbackRecovery, withProfileRestoreColdRollbackAuthority } from './prepareProfileRestoreColdRollbackRecovery.js';
import type { ProfileRestoreActivationJournal } from './profileRestoreActivationJournal.js';
import type { ProfileRestoreActivationTransaction } from './profileRestoreActivationTransaction.js';
import type { ProfileRestoreStartupRecovery } from './profileRestoreStartupRecovery.js';
import type { ProfileRestoreColdContentContext } from './prepareProfileRestoreColdForwardRecovery.js';

describe('cold rollback reservation handoff', () => {
  it.each([false, true])('retains the caller restore lease across rollback (close failure: %s)', async closeFailure => {
    const f = fixture('validationStarting'); const held = await f.lease.acquire('restore');
    const assertBorrowedRestoreOwner = f.lease.captureCurrentOwner(['restore']);
    const acquire = vi.spyOn(f.lease, 'acquire'); const use = vi.fn(async () => {});
    const first = new Error('synthetic anchor close failure');
    if (closeFailure) f.anchor.close.mockRejectedValue(first);
    try {
      const result = withProfileRestoreColdRollbackAuthority({ ...f.input, assertBorrowedRestoreOwner }, use);
      if (closeFailure) await expect(result).rejects.toMatchObject({ cause: first });
      else await result;
      expect(use).toHaveBeenCalledOnce(); expect(acquire).not.toHaveBeenCalled();
      expect(assertBorrowedRestoreOwner).not.toThrow();
      expect(f.anchor.close).toHaveBeenCalledOnce(); expect(f.rollback.close).toHaveBeenCalledOnce();
    } finally { await held.release(); }
  });

  it.each(['missing', 'wrongPurpose', 'replaced'] as const)(
    'rejects a %s borrowed rollback owner before claiming files', async state => {
      const f = fixture('validationStarting');
      let held = state === 'missing' ? undefined : await f.lease.acquire(state === 'wrongPurpose' ? 'update' : 'restore');
      const assertBorrowedRestoreOwner = state === 'replaced' ? f.lease.captureCurrentOwner(['restore']) : () => {};
      if (state === 'replaced') { await held!.release(); held = await f.lease.acquire('restore'); }
      const use = vi.fn(async () => {});
      try {
        await expect(withProfileRestoreColdRollbackAuthority({ ...f.input, assertBorrowedRestoreOwner }, use))
          .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
        expect(f.acquire).not.toHaveBeenCalled(); expect(use).not.toHaveBeenCalled();
        expect(f.lease.readState()).toBe(state === 'missing' ? 'idle' : 'busy');
      } finally { await held?.release(); }
    },
  );

  it('rejects a borrowed owner replaced during content inspection without releasing its successor', async () => {
    const f = fixture('validationStarting'); let held = await f.lease.acquire('restore');
    const assertBorrowedRestoreOwner = f.lease.captureCurrentOwner(['restore']);
    const use = vi.fn(async () => {});
    f.input.assertContent.mockImplementation(async context => {
      await held.release(); held = await f.lease.acquire('restore');
      context.assertAuthority();
    });
    try {
      await expect(withProfileRestoreColdRollbackAuthority({ ...f.input, assertBorrowedRestoreOwner }, use))
        .rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(use).not.toHaveBeenCalled(); expect(f.lease.readState()).toBe('busy');
    } finally { await held.release(); }
  });

  it('uses the same claims for validation failure without re-entering startup preparation', async () => {
    const f = fixture('validationStarting');
    await withProfileRestoreColdRollbackAuthority(f.input, async admission => {
      await admission.assertContent(f.journal);
      f.journal.phase = 'rollbackStarting'; f.journal.revision++;
      await admission.beforeStagingMove(f.journal);
      f.journal.phase = 'rolledBack'; f.journal.revision++;
      await admission.assertContent(f.journal);
    });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.input.assertContent.mock.calls.map(([context]) => context.journal.phase))
      .toEqual(['validationStarting', 'validationStarting', 'rollbackStarting', 'rolledBack']);
    expect(f.staging.close).toHaveBeenCalledOnce(); expect(f.anchor.close).toHaveBeenCalledOnce();
    expect(f.rollback.close).toHaveBeenCalledOnce(); expect(f.lease.readState()).toBe('idle');
  });

  it.each([['rollbackStarting', 2], ['rolledBack', 1], ['accepted', 1]] as const)(
    'rejects foreign progression %s +%s from the selected validation journal', async (phase, offset) => {
      const f = fixture('validationStarting');
      await expect(withProfileRestoreColdRollbackAuthority(f.input, async admission => {
        await admission.assertContent({ ...f.journal, phase, revision: f.journal.revision + offset });
      })).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(f.input.assertContent).toHaveBeenCalledOnce(); expect(f.prepare).not.toHaveBeenCalled();
      expect(f.lease.readState()).toBe('idle');
    },
  );

  it('keeps validationStarting outside the cold startup wrapper', async () => {
    const f = fixture('validationStarting');
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.acquire).not.toHaveBeenCalled(); expect(f.prepare).not.toHaveBeenCalled();
  });

  it('keeps installation and source authority during the anchor transfer without claiming main ownership early', async () => {
    const f = fixture(); let transferred = false;
    f.anchor.assertMainCurrent.mockImplementation(() => { if (transferred) throw new Error('synthetic native transfer'); });
    f.input.assertContent.mockImplementation(async context => {
      await context.assertCurrent();
      transferred = true;
      try { context.assertAuthority(); }
      finally { transferred = false; }
      await context.assertCurrent();
    });
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).resolves.toBe('validateRolledBackProfile');
    expect(f.anchor.close).toHaveBeenCalledOnce();
  });
  it('claims exact source identities before the stationary anchor and releases staging only at its move', async () => {
    const f = fixture();
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).resolves.toBe('validateRolledBackProfile');
    expect(f.events).toEqual(['claim:staging', 'claim:rollback', 'claim:anchor', 'content', 'prepare',
      'content', 'close:staging', 'content', 'close:anchor', 'close:rollback']);
    expect(f.lease.readState()).toBe('idle');
    expect(f.staging.assertMainOwned).toHaveBeenCalled();
    expect(f.acquire.mock.calls.map(([root, identity]) => [root, identity])).toEqual([
      ['staging', 's'.repeat(64)], ['rollback', 'r'.repeat(64)], ['anchor', 'a'.repeat(64)],
    ]);
  });

  it('handles rolledBack with no moving source claims', async () => {
    const f = fixture('rolledBack');
    f.roots.sources = [];
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).resolves.toBe('validateRolledBackProfile');
    expect(f.acquire).toHaveBeenCalledOnce();
    expect(f.events).toEqual(['claim:anchor', 'content', 'prepare', 'content', 'close:anchor']);
  });

  it('does not enter recovery or claim sources under a competing maintenance lease', async () => {
    const f = fixture(); const held = await f.lease.acquire('backup');
    try {
      await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
      expect(f.acquire).not.toHaveBeenCalled();
      expect(f.prepare).not.toHaveBeenCalled();
    } finally { await held.release(); }
  });

  it.each(['beforeClaim', 'afterClaim'] as const)('rejects a stale selected journal at %s before recovery', async stage => {
    const f = fixture();
    const foreign = { ...f.journal, revision: f.journal.revision + 1 };
    if (stage === 'beforeClaim') f.peek.mockResolvedValue(foreign);
    else f.acquire.mockImplementation(async root => {
      f.peek.mockResolvedValue(foreign); return f.reservations[root as keyof typeof f.reservations];
    });
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.lease.readState()).toBe('idle');
  });

  it('does not move staging if closing its claim fails', async () => {
    const f = fixture(); const closeError = new Error('synthetic staging close');
    f.staging.close.mockRejectedValueOnce(closeError);
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).rejects.toMatchObject({ cause: closeError });
    expect(f.staging.close).toHaveBeenCalledTimes(2);
    expect(f.anchor.close).toHaveBeenCalledOnce();
    expect(f.rollback.close).toHaveBeenCalledOnce();
    expect(f.events.filter(event => event === 'content')).toHaveLength(2);
  });

  it('retains the first inspection failure independently of all claim-close failures', async () => {
    const f = fixture(); const first = new Error('synthetic content rejection');
    const anchor = new Error('synthetic anchor close'); const rollback = new Error('synthetic rollback close');
    f.input.assertContent.mockRejectedValue(first);
    f.anchor.close.mockRejectedValue(anchor); f.rollback.close.mockRejectedValue(rollback);
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).rejects.toMatchObject({ cause: { errors: [first, anchor, rollback] } });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.staging.close).toHaveBeenCalledOnce();
    expect(f.lease.readState()).toBe('idle');
  });

  it('rejects a different rolledBack revision before taking mutation authority', async () => {
    const f = fixture();
    f.prepare.mockImplementation(async admission => {
      await admission!.assertContent({ ...f.journal, phase: 'rolledBack', revision: f.journal.revision + 2 });
      return 'validateRolledBackProfile';
    });
    await expect(prepareProfileRestoreColdRollbackRecovery(f.input)).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.input.assertContent).toHaveBeenCalledOnce();
  });

  it('invalidates all remaining claims when cancellation overtakes a pending owner read', async () => {
    const f = fixture();
    let finish!: () => void; let started!: () => void;
    const reading = new Promise<void>(resolve => { started = resolve; });
    f.prepare.mockImplementation(async admission => {
      f.anchor.assertMainOwned.mockImplementation(() => { started(); return new Promise<void>(resolve => { finish = resolve; }); });
      return admission!.assertCurrent().then(() => 'validateRolledBackProfile' as const);
    });
    const operation = prepareProfileRestoreColdRollbackRecovery(f.input);
    await reading;
    f.signal!.dispatchEvent(new Event('abort'));
    await expect(operation).rejects.toThrow('PROFILE_RESTORE_RECOVERY_REQUIRED');
    expect(f.anchor.invalidate).toHaveBeenCalled();
    expect(f.staging.invalidate).toHaveBeenCalled();
    expect(f.rollback.invalidate).toHaveBeenCalled();
    finish();
  });
});

function fixture(phase: 'validationStarting' | 'rollbackStarting' | 'rolledBack' = 'rollbackStarting') {
  const events: string[] = [];
  const journal: ProfileRestoreActivationJournal = { formatVersion: 1, operationId: randomUUID(), phase,
    revision: 10, hadActiveDatabase: true, hadActiveDocuments: true };
  const reservation = (name: string) => ({ assertMainOwned: vi.fn(async () => {}), assertMainCurrent: vi.fn(() => {}),
    close: vi.fn(async () => { events.push(`close:${name}`); }), invalidate: vi.fn(() => {}),
    bind() { throw new Error('not used by this reservation fixture'); } });
  const staging = reservation('staging'); const rollback = reservation('rollback'); const anchor = reservation('anchor');
  const reservations = { staging, rollback, anchor };
  const f = { signal: undefined as AbortSignal | undefined };
  const acquire = vi.fn(async (root: string, _identity: string, signal: AbortSignal) => {
    f.signal = signal; events.push(`claim:${root}`); return reservations[root as keyof typeof reservations];
  });
  const roots = { anchorRoot: 'anchor', anchorIdentity: 'a'.repeat(64), sources: [
    { role: 'staging' as const, root: 'staging', identity: 's'.repeat(64) },
    { role: 'rollback' as const, root: 'rollback', identity: 'r'.repeat(64) },
  ] };
  type Prepare = ProfileRestoreActivationTransaction['prepareColdRollbackAnchor'];
  const transaction = { prepareColdRollbackAnchor: vi.fn<Prepare>(async (_selected, claim, assertCurrent) => {
    await assertCurrent(); await claim(roots.sources); await assertCurrent(); return roots;
  }) };
  const peek = vi.fn(async () => journal);
  const lease = new InMemoryWorkspaceMaintenanceLease();
  const prepare = vi.fn<ProfileRestoreStartupRecovery['prepareBeforeBackend']>(async admission => {
    events.push('prepare'); await admission!.assertCurrent();
    if (phase === 'rollbackStarting') {
      if (!('kind' in admission!) || admission.kind !== 'rollback') throw new Error('missing rollback admission');
      await admission.beforeStagingMove(journal);
      staging.assertMainOwned.mockImplementation(async () => { throw new Error('released descriptor must not be reused'); });
    }
    await admission!.assertContent({ ...journal, phase: 'rolledBack', revision: journal.revision + (phase === 'rollbackStarting' ? 1 : 0) });
    return 'validateRolledBackProfile';
  });
  const input = { journal, journalStore: { peek }, transaction, maintenanceLease: lease,
    assertMainOwned: async () => {}, assertAuthority() {}, acquireReservation: acquire,
    assertContent: vi.fn(async (_context: ProfileRestoreColdContentContext) => { events.push('content'); }), recovery: { prepareBeforeBackend: prepare } };
  return { input, journal, events, roots, reservations, staging, rollback, anchor, acquire, prepare, peek, lease,
    get signal() { return f.signal; } };
}
