import { createHash } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from './profileInspectionArtifactIdentity.js';
import { profileInspectionDocumentBindingsFileName, type ProfileInspectionDocumentBinding } from './profileInspectionDocumentBindings.js';
import { readProfileInspectionDocumentBindings as read, writeProfileInspectionDocumentBindings as write } from './profileInspectionDocumentBindingsFile.js';

const roots: string[] = [];
const document: ProfileInspectionDocumentBinding = { storagePath: 'company/invoice/document.pdf',
  logicalPath: `artifacts/invoicing/invoice-documents/${'a'.repeat(64)}.pdf`, byteSize: 6, sha256: 'b'.repeat(64) };

afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fileSystem.rm(root, { recursive: true, force: true });
});

describe('generation-owned cold binding file', () => {
  it.each([{ documents: [] }, { documents: [document] }])('writes an exclusive bounded output and reads the receipt-bound bytes', async ({ documents }) => {
    const f = await fixture(documents);
    const result = await read(f.root, f.receipt, f.signal);
    expect(result).toEqual(documents);
    expect(Object.isFrozen(result)).toBe(true);
    await expect(write(f.root, documents, f.signal)).rejects.toThrow();
    expect(await read(f.root, f.receipt, f.signal)).toEqual(documents);
  });

  it.each(['missing', 'changed', 'hash', 'size', 'hardlink'] as const)('rejects %s output without deleting evidence', async kind => {
    const f = await fixture([document]);
    const path = join(f.root, profileInspectionDocumentBindingsFileName);
    if (kind === 'missing') await fileSystem.unlink(path);
    if (kind === 'changed') await fileSystem.writeFile(path, Buffer.alloc(f.receipt.byteSize, 65));
    if (kind === 'hash') f.receipt.sha256 = 'f'.repeat(64);
    if (kind === 'size') f.receipt.byteSize += 1;
    if (kind === 'hardlink') await fileSystem.link(path, join(f.root, 'retained'));
    await expect(read(f.root, f.receipt, f.signal)).rejects.toThrow();
    expect(await fileSystem.readdir(f.root)).toEqual(kind === 'missing' ? [] : kind === 'hardlink'
      ? [profileInspectionDocumentBindingsFileName, 'retained'] : [profileInspectionDocumentBindingsFileName]);
  });

  it('rejects an unbounded receipt before opening the file', async () => {
    const f = await fixture([]);
    const open = vi.spyOn(fileSystem, 'open');
    await expect(read(f.root, { ...f.receipt, byteSize: Number.MAX_SAFE_INTEGER }, f.signal)).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it('rejects a linked root', async () => {
    const f = await fixture([]);
    const path = join(dirname(f.root), `${f.root.split(/[\\/]/).at(-1)}-link`);
    roots.push(path);
    await fileSystem.symlink(f.root, path, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(read(path, f.receipt, f.signal)).rejects.toThrow();
  });

  it('rejects a same-size path replacement while its old handle is open', async () => {
    const f = await fixture([document]);
    const open = fileSystem.open.bind(fileSystem);
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof fileSystem.open>) => {
      const handle = await open(...args);
      const path = join(f.root, profileInspectionDocumentBindingsFileName);
      const bytes = await fileSystem.readFile(path);
      await fileSystem.rename(path, join(f.root, 'retained'));
      await fileSystem.writeFile(path, bytes);
      return handle;
    });
    await expect(read(f.root, f.receipt, f.signal)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('preserves first read cause before a separate close failure', async () => {
    const f = await fixture([]);
    const open = fileSystem.open.bind(fileSystem);
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof fileSystem.open>) => {
      const handle = await open(...args);
      const close = handle.close.bind(handle);
      vi.spyOn(handle, 'read').mockRejectedValue(new Error('synthetic-first-read'));
      vi.spyOn(handle, 'close').mockImplementation(async () => { await close(); throw new Error('synthetic-close'); });
      return handle;
    });
    const error = await read(f.root, f.receipt, f.signal).catch(error => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors.map((cause: Error) => cause.message)).toEqual(['synthetic-first-read', 'synthetic-close']);
  });

  it('honors cancellation without reading or removing the output', async () => {
    const f = await fixture([]);
    f.cancellation.abort();
    const open = vi.spyOn(fileSystem, 'open');
    await expect(read(f.root, f.receipt, f.signal)).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(open).not.toHaveBeenCalled();
    expect(await fileSystem.readdir(f.root)).toEqual([profileInspectionDocumentBindingsFileName]);
  });
});

async function fixture(documents: readonly ProfileInspectionDocumentBinding[]) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-cold-bindings-'));
  await fileSystem.chmod(root, 0o700);
  roots.push(root);
  const cancellation = new AbortController();
  const receipt = { ...await write(root, documents, cancellation.signal), artifactCount: documents.length,
    artifactTotalByteSize: documents.reduce((sum, item) => sum + item.byteSize, 0),
    artifactIdentity: createProfileSnapshotArtifactIdentity(documents) };
  expect(receipt.sha256).toBe(createHash('sha256').update(await fileSystem.readFile(join(root, profileInspectionDocumentBindingsFileName))).digest('hex'));
  return { root, receipt, cancellation, signal: cancellation.signal };
}
