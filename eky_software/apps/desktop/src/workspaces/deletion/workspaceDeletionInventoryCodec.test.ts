import { describe, expect, it } from 'vitest';
import { workspaceOwnedEntryNames } from '../adoption/workspaceLegacyAdoptionRootStore.js';
import { captureDeletionInventoryCommitment, captureDeletionInventoryHeader, captureDeletionInventoryRecord } from './workspaceDeletionInventoryCodec.js';
import { deletionTestDigest as hash, deletionTestHeader as header, deletionTestId as id, deletionTestRecord } from './workspaceDeletionDataTestSupport.js';

describe('deletion inventory values', () => {
  it('copies and freezes the target and lineage without keeping mutable input', () => {
    const input = { ...header, lineageIdentity: { ...header.lineageIdentity } };
    const captured = captureDeletionInventoryHeader(input);
    input.lineageIdentity.profileId = hash('changed');
    expect(captured.lineageIdentity.profileId).toBe(header.lineageIdentity.profileId);
    expect(Object.isFrozen(captured)).toBe(true);
    expect(Object.isFrozen(captured.lineageIdentity)).toBe(true);
  });

  it.each([{ workspaceId: '../outside' }, { operationId: id(1).toUpperCase().replace('00000000', 'AAAAAAAA') },
    { formatVersion: 1 }, { formatVersion: 3 }, { path: 'outside' }, { registryEntrySha256: 'A'.repeat(64) },
    { lineageIdentity: { ...header.lineageIdentity, password: 'synthetic-only' } },
  ])('rejects invalid target %#', change => {
    expect(() => captureDeletionInventoryHeader({ ...header, ...change })).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  });

  it('uses the adoption owner list and enforces each role-specific field', () => {
    for (const member of workspaceOwnedEntryNames) {
      expect(captureDeletionInventoryRecord({ ...deletionTestRecord(), role: 'legacyEntry',
        ownerOperationId: null, member }).member).toBe(member);
    }
    expect(captureDeletionInventoryRecord({ ...deletionTestRecord(), role: 'workspace',
      ownerOperationId: null, bindingSha256: null }).role).toBe('workspace');
    expect(captureDeletionInventoryRecord({ ...deletionTestRecord(), role: 'inspection', generationId: id(9) }).generationId).toBe(id(9));
    for (const role of ['replacementImport', 'activationStaging', 'activationRollback', 'activationFailed', 'importCandidate', 'adoptionCandidate']) {
      expect(captureDeletionInventoryRecord({ ...deletionTestRecord(), role }).role).toBe(role);
    }
  });

  it.each([{ role: 'unknown' }, { generationId: id(3) }, { member: '../data' }, { bindingSha256: null },
    { rootIdentity: '' }, { parentIdentity: 1 }, { ownerOperationId: null }, { path: 'outside' },
    { role: 'workspace', ownerOperationId: null }, { role: 'legacyEntry', ownerOperationId: null, member: 'logs' },
    { role: 'inspection', generationId: null }, { role: 'legacyEntry', member: 'data' },
  ])('rejects an invalid descriptor %#', change => {
    expect(() => captureDeletionInventoryRecord({ ...deletionTestRecord(), ...change })).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  });

  it('does not read accessors or accept symbols or non-data prototypes', () => {
    let invoked = false;
    const accessor = { ...header };
    Object.defineProperty(accessor, 'workspaceId', { get: () => { invoked = true; return id(2); } });
    for (const value of [accessor, { ...header, [Symbol('hidden')]: true }, Object.assign(Object.create({ inherited: true }), header)]) {
      expect(() => captureDeletionInventoryHeader(value)).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
    }
    expect(invoked).toBe(false);
  });

  it.each([{ byteLength: 0 }, { byteLength: NaN }, { byteLength: Infinity }, { recordCount: -1 },
    { recordCount: Number.MAX_SAFE_INTEGER + 1 }, { recordCount: '1' }, { sha256: '' }, { extra: true },
  ])('rejects invalid commitment %#', change => {
    expect(() => captureDeletionInventoryCommitment({ formatVersion: 2, byteLength: 5, recordCount: 0,
      sha256: hash('value'), ...change })).toThrow('WORKSPACE_DELETE_INVENTORY_INVALID');
  });
});
