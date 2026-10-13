import { describe, expect, it } from 'vitest';

import { PreparedProfileRestoreOwner } from './preparedProfileRestoreOwner.js';

const operationId = '11111111-1111-4111-8111-111111111111';

describe('prepared profile restore ownership', () => {
  it('claims only the exact prepared operation and blocks discard and competing claims', () => {
    const owner = createOwner();
    expect(owner.claim('22222222-2222-4222-8222-222222222222')).toBeUndefined();
    const claim = owner.claim(operationId)!;
    expect(claim.prepared.operationId).toBe(operationId);
    expect(() => owner.clear(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    expect(() => owner.claim(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    claim.release();
    expect(owner.get(operationId)).toBe(claim.prepared);
    owner.clear(operationId);
    expect(owner.get(operationId)).toBeUndefined();
  });

  it('keeps the durable or uncertain activation slot non-discardable after claim release', () => {
    const owner = createOwner();
    const claim = owner.claim(operationId)!;
    claim.preserveForRecovery();
    claim.release();
    expect(owner.get(operationId)).toBeUndefined();
    expect(() => owner.clear(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    expect(() => owner.claim(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    expect(() => owner.assertCanStage()).toThrow('PROFILE_RESTORE_BUSY');
  });

  it('does not let a stale released claim alter or release a newer claim', () => {
    const owner = createOwner();
    const first = owner.claim(operationId)!;
    first.release();
    const second = owner.claim(operationId)!;
    expect(() => first.preserveForRecovery()).toThrow('PROFILE_RESTORE_BUSY');
    first.release();
    expect(() => owner.clear(operationId)).toThrow('PROFILE_RESTORE_BUSY');
    second.release();
    expect(owner.get(operationId)).toBeDefined();
  });

  it('retains an immutable independent prepared identity and summary', () => {
    const owner = new PreparedProfileRestoreOwner();
    const prepared = createPrepared();
    const retained = owner.set(prepared);
    prepared.operationId = '22222222-2222-4222-8222-222222222222';
    prepared.summary.documentCount = 99;
    expect(retained.operationId).toBe(operationId);
    expect(retained.summary.documentCount).toBe(0);
    expect(Object.isFrozen(retained)).toBe(true);
    expect(Object.isFrozen(retained.summary)).toBe(true);
  });
});

function createOwner() {
  const owner = new PreparedProfileRestoreOwner();
  owner.set(createPrepared());
  return owner;
}

function createPrepared() {
  return {
    operationId,
    summary: {
      appVersion: '0.1.0-alpha.1', compatibilityStatus: 'compatible' as const,
      createdAt: '2026-08-04T00:00:00.000Z', databaseHealth: 'healthy' as const,
      documentCount: 0, formatVersion: 1 as const, profileMatchStatus: 'same' as const,
      totalBusinessByteSize: 1,
    },
    targetDisposition: 'replaceActiveProfile' as const,
  };
}
