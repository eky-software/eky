import { describe, expect, it, vi } from 'vitest';
import { captureWorkspaceDeletionJournal } from '../workspaces/deletion/workspaceDeletionJournalCodec.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { bindWorkspaceDeletionContinuation, type WorkspaceDeletionMainCommand } from './workspaceDeletionContinuation.js';

const operationId = '11111111-1111-4111-8111-111111111111';
const workspaceId = validateWorkspaceId('22222222-2222-4222-8222-222222222222');
const otherWorkspaceId = validateWorkspaceId('33333333-3333-4333-8333-333333333333');

describe('main-only deletion terminal binding', () => {
  it.each([workspaceId, otherWorkspaceId, null])('seals only the active target (%s)', async activeWorkspaceId => {
    const f = fixture(activeWorkspaceId);
    await f.publish();
    expect(f.seal).toHaveBeenCalledTimes(activeWorkspaceId === workspaceId ? 1 : 0);
    expect(f.removed).not.toHaveBeenCalled();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    expect(owner.recordRemoved(f.receipt())).toEqual({ formatVersion: 1, status: 'completed',
      navigation: activeWorkspaceId === otherWorkspaceId ? 'reopenPrevious' : 'selector' });
    expect(f.removed).toHaveBeenCalledTimes(activeWorkspaceId === workspaceId ? 1 : 0);
    expect(() => owner.recordRemoved(f.receipt())).toThrow();
  });

  it('joins an already started marker write and rechecks ownership before publication', async () => {
    const f = fixture();
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    f.seal.mockImplementationOnce(async () => { await gate; });
    const publishing = f.publish();
    expect(f.seal).toHaveBeenCalledOnce();
    expect(f.command.publish).not.toHaveBeenCalled();
    f.revoke(); finish();
    await expect(publishing).rejects.toThrow();
    expect(f.command.publish).not.toHaveBeenCalled();
    expect(f.removed).not.toHaveBeenCalled();
  });

  it.each(['operation', 'target', 'root', 'registry', 'phase'] as const)('rejects a foreign publication: %s', async changed => {
    const f = fixture();
    f.command.publish.mockImplementationOnce(async () => ({ journal: captureWorkspaceDeletionJournal({ ...f.journal,
      ...(changed === 'operation' ? { target: { ...f.journal.target, operationId: '44444444-4444-4444-8444-444444444444' } } : {}),
      ...(changed === 'target' ? { target: { ...f.journal.target, workspaceId: otherWorkspaceId } } : {}),
      ...(changed === 'registry' ? { registryBeforeSha256: 'f'.repeat(64) } : {}),
      ...(changed === 'phase' ? { phase: 'registryPublished' } : {}),
    }), workspaceRootIdentity: changed === 'root' ? '0'.repeat(64) : f.target.rootIdentity }));
    await expect(f.publish()).rejects.toThrow();
    expect(() => f.binding.continuation.captureAuthority(operationId, f.assertLease)).toThrow();
  });

  it.each(['shutdown', 'lease', 'reentry', 'changedBinding', 'extraField', 'nonterminal'] as const)(
    'rejects an invalid final receipt: %s', async changed => {
      const f = fixture(); await f.publish();
      const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
      if (changed === 'shutdown') f.revoke();
      if (changed === 'lease') f.assertLease.mockImplementation(() => { throw new Error('SYNTHETIC_FOREIGN_LEASE'); });
      if (changed === 'reentry') f.assertLease.mockImplementation(() => { f.revoke(); });
      const receipt = f.receipt();
      await expect(Promise.resolve().then(() => owner.recordRemoved({ ...receipt,
        ...(changed === 'extraField' ? { extra: true } : {}),
        journal: { ...receipt.journal,
          ...(changed === 'changedBinding' ? { registryAfterSha256: '0'.repeat(64) } : {}),
          ...(changed === 'nonterminal' ? { phase: 'purged' } : {}),
        },
      }))).rejects.toThrow();
      expect(f.removed).not.toHaveBeenCalled();
    });

  it('captures publisher and consumer methods before collaborators can replace them', async () => {
    const f = fixture();
    const unexpected = vi.fn((): never => { throw new Error('SYNTHETIC_FOREIGN_CALLBACK'); });
    f.command.publish = unexpected;
    f.command.resume = unexpected;
    await f.publish();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    const authority = { ...owner, recordRemoved(value: unknown) { owner.recordRemoved(value); } };
    await f.binding.continuation.resume(operationId, authority);
    expect(unexpected).not.toHaveBeenCalled();
  });

  it('forwards the original preparation selection independently of the full publication check', async () => {
    const f = fixture();
    await f.publish();
    expect(f.command.publish.mock.calls[0]![4]).toBe(f.assertPreparationCurrent);
    await f.command.publish.mock.calls[0]![4]();
    f.revoke();
    await expect(f.command.publish.mock.calls[0]![4]()).rejects.toThrow('SYNTHETIC_MAIN_REVOKED');
  });

  it('rejects nested terminal delivery from the final lease guard', async () => {
    const f = fixture(); await f.publish();
    const owner = f.binding.continuation.captureAuthority(operationId, f.assertLease);
    const nestedFailures: unknown[] = [];
    f.assertLease.mockImplementationOnce(() => {
      try { owner.recordRemoved(f.receipt()); }
      catch (error) { nestedFailures.push(error); }
    });
    owner.recordRemoved(f.receipt());
    expect(nestedFailures).toHaveLength(1);
    expect(f.removed).toHaveBeenCalledOnce();
  });
});

function fixture(activeWorkspaceId: typeof workspaceId | null = workspaceId) {
  let current = true;
  const target = Object.freeze({ workspaceId, workspaceLabel: 'Synthetic', profileId: 'a'.repeat(64),
    lifecycleState: 'ready' as const, previousActiveWorkspaceId: activeWorkspaceId,
    registrySha256: 'b'.repeat(64), registryEntrySha256: 'c'.repeat(64), rootIdentity: 'd'.repeat(64) });
  const journal = captureWorkspaceDeletionJournal({ formatVersion: 1, phase: 'authorized',
    target: { formatVersion: 2, operationId, workspaceId, lineageIdentity: { formatVersion: 1, profileId: target.profileId },
      registryEntrySha256: target.registryEntrySha256 },
    registryBeforeSha256: target.registrySha256, registryAfterSha256: 'e'.repeat(64),
    previousActiveWorkspaceId: activeWorkspaceId, backupDisposition: 'explicitDataLoss',
    inventory: { formatVersion: 2, byteLength: 1, recordCount: 1, sha256: 'f'.repeat(64) },
    inventoryFileIdentity: 'a'.repeat(64), operationRootIdentity: 'b'.repeat(64), operationParentIdentity: 'c'.repeat(64) });
  const assertCurrent = () => { if (!current) throw new Error('SYNTHETIC_MAIN_REVOKED'); };
  const assertPreparationCurrent = async () => { assertCurrent(); };
  const assertLease = vi.fn();
  const seal = vi.fn(async () => undefined);
  const removed = vi.fn();
  const command = { publish: vi.fn<WorkspaceDeletionMainCommand['publish']>(async () => ({ journal, workspaceRootIdentity: target.rootIdentity })),
    resume: vi.fn<WorkspaceDeletionMainCommand['resume']>(async (_id, authority) => {
      authority.recordRemoved({ status: 'removed', journal: { ...journal, phase: 'registryPublished' } });
      return { formatVersion: 1, status: 'completed', navigation: 'selector' };
    }) };
  const binding = bindWorkspaceDeletionContinuation({ command, activeWorkspaceId, assertCurrent,
    async assertOwned() { assertCurrent(); }, sealActiveMarker: seal, recordActiveRemoved: removed });
  return { binding, command, journal, target, assertLease, seal, removed, assertPreparationCurrent,
    revoke() { current = false; },
    receipt: () => ({ status: 'removed', journal: { ...journal, phase: 'registryPublished' } }),
    publish: () => binding.publish(assertCurrent, async () => { assertCurrent(); }, target,
      { operationId, target, backupDisposition: 'explicitDataLoss' }, assertPreparationCurrent),
  };
}
