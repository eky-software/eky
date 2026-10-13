import { describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from './profileInspectionArtifactIdentity.js';
import {
  decodeProfileInspectionDocumentBindings as decode, encodeProfileInspectionDocumentBindings as encode,
  profileInspectionMaximumCatalogBytes, profileInspectionMaximumDocumentCount, profileInspectionMaximumDocumentBytes,
  type ProfileInspectionDocumentBinding,
} from './profileInspectionDocumentBindings.js';

const document: ProfileInspectionDocumentBinding = {
  logicalPath: `artifacts/invoicing/invoice-documents/${'a'.repeat(64)}.pdf`,
  storagePath: 'synthetic-company/invoice/document.pdf', byteSize: 7, sha256: 'b'.repeat(64),
};
const summary = (documents: readonly ProfileInspectionDocumentBinding[]) => ({ artifactCount: documents.length,
  artifactTotalByteSize: documents.reduce((sum, item) => sum + item.byteSize, 0),
  artifactIdentity: createProfileSnapshotArtifactIdentity(documents) });

describe('ephemeral cold document binding contract', () => {
  it.each([{ documents: [] }, { documents: [document] }])('round trips an exact immutable selection', ({ documents }) => {
    const result = decode(encode(documents), summary(documents));
    expect(result).toEqual(documents);
    expect(Object.isFrozen(result)).toBe(true);
    for (const item of result) expect(Object.isFrozen(item)).toBe(true);
  });

  it.each(['artifactCount', 'artifactTotalByteSize', 'artifactIdentity'] as const)('rejects a receipt with wrong %s', key => {
    const expected = { ...summary([document]), [key]: key === 'artifactIdentity' ? 'c'.repeat(64) : 2 };
    expect(() => decode(encode([document]), expected)).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it.each([
    '../outside.pdf', '/absolute.pdf', 'drive:/outside.pdf', 'company\\document.pdf',
    'company//document.pdf', 'company/./document.pdf', 'company/../document.pdf', 'company/stream:pdf',
    'company/\u0000.pdf', 'company/\ud800.pdf', 'a'.repeat(1_025),
  ])('rejects unsafe or unbounded storage path %s', storagePath => {
    expect(() => encode([{ ...document, storagePath }])).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it.each([
    { byteSize: 0 }, { byteSize: 4 }, { byteSize: 1.5 }, { byteSize: profileInspectionMaximumDocumentBytes + 1 },
    { sha256: 'raw' }, { logicalPath: 'other.pdf' }, { extra: 'business data' },
  ])('rejects a malformed selected document', change => {
    expect(() => encode([{ ...document, ...change }])).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('rejects duplicate logical IDs and case-folded physical aliases', () => {
    expect(() => encode([document, { ...document, storagePath: 'other.pdf' }])).toThrow();
    expect(() => encode([document, { ...document, logicalPath: `artifacts/invoicing/invoice-documents/${'c'.repeat(64)}.pdf`,
      storagePath: document.storagePath.toUpperCase() }])).toThrow();
  });

  it.each([
    '{"schemaVersion":2,"documents":[]}', '{"schemaVersion":1,"documents":[],"extra":true}',
    '{"schemaVersion":1,"documents":null}', '[]', '{invalid',
  ])('rejects extra fields and invalid containers', text => {
    expect(() => decode(Buffer.from(text), summary([]))).toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('rejects non-UTF8 and oversized/count-overflow output', () => {
    expect(() => decode(Buffer.from([255]), summary([]))).toThrow();
    expect(() => decode(Buffer.alloc(profileInspectionMaximumCatalogBytes + 1), summary([]))).toThrow();
    expect(() => encode(Array(profileInspectionMaximumDocumentCount + 1).fill(document))).toThrow();
  });

  it('does not execute item getters', () => {
    const getter = vi.fn(() => 7);
    expect(() => encode([{ ...document, get byteSize() { return getter(); } }])).toThrow();
    expect(getter).not.toHaveBeenCalled();
  });
});
