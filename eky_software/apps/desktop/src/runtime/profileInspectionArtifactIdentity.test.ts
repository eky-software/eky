import { describe, expect, it } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from './profileInspectionArtifactIdentity.js';

const first = { logicalPath: 'artifacts/invoicing/invoice-documents/a.pdf', byteSize: 10, sha256: 'a'.repeat(64) };
const second = { logicalPath: 'artifacts/invoicing/invoice-documents/b.pdf', byteSize: 10, sha256: 'b'.repeat(64) };

describe('private snapshot artifact set identity', () => {
  it('binds an empty set without requiring a PDF', () => {
    expect(createProfileSnapshotArtifactIdentity([])).toMatch(/^[a-f0-9]{64}$/);
    expect(createProfileSnapshotArtifactIdentity([])).not.toBe(createProfileSnapshotArtifactIdentity([first]));
  });

  it('is independent of catalog order without mutating the supplied list', () => {
    const reversed = [second, first];
    expect(createProfileSnapshotArtifactIdentity(reversed)).toBe(createProfileSnapshotArtifactIdentity([first, second]));
    expect(reversed).toEqual([second, first]);
  });

  it.each(['logicalPath', 'byteSize', 'sha256'] as const)('binds the exact %s', key => {
    const changed = { ...first, [key]: key === 'byteSize' ? 11 : key === 'sha256' ? 'c'.repeat(64) : 'different.pdf' };
    expect(createProfileSnapshotArtifactIdentity([changed])).not.toBe(createProfileSnapshotArtifactIdentity([first]));
  });

  it('distinguishes equal-sized PDFs swapped between unchanged document addresses', () => {
    expect(createProfileSnapshotArtifactIdentity([{ ...first, sha256: second.sha256 }, { ...second, sha256: first.sha256 }]))
      .not.toBe(createProfileSnapshotArtifactIdentity([first, second]));
  });

  it('rejects duplicate document addresses', () => {
    expect(() => createProfileSnapshotArtifactIdentity([first, { ...first, sha256: second.sha256 }]))
      .toThrow('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  });

  it.each([{ byteSize: -1 }, { byteSize: 0.5 }, { byteSize: Number.MAX_SAFE_INTEGER + 1 },
    { logicalPath: '' }, { sha256: 'invalid' }])('rejects malformed identity data %j', change => {
    expect(() => createProfileSnapshotArtifactIdentity([{ ...first, ...change }]))
      .toThrow('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  });
});
