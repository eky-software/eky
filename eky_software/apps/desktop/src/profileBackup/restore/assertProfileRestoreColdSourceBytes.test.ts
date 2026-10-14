import { createHash, randomUUID } from 'node:crypto';
import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createProfileSnapshotArtifactIdentity } from '../../runtime/profileInspectionArtifactIdentity.js';
import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import type { ProfileInspectionColdSources } from '../../runtime/profileInspectionMessages.js';
import type { ProfileRestoreColdInspectionResult } from './runProfileRestoreColdInspection.js';
import { assertProfileRestoreColdSourceBytes as assertBytes } from './assertProfileRestoreColdSourceBytes.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) await fileSystem.rm(root, { recursive: true, force: true });
});

describe('fresh cold source byte revalidation without SQLite', () => {
  it.each([['active', 'active'], ['active', 'staged'], ['staged', 'active'], ['staged', 'staged']] as const)(
    'uses the %s database and %s PDF slots', async (databaseSlot, documentsSlot) => {
      const f = await fixture({ databaseSlot, documentsSlot });
      await assertBytes(f.input);
      expect(await fileSystem.readFile(f.databasePath)).toEqual(f.database);
      expect(await fileSystem.readFile(f.pdfPath)).toEqual(f.pdf);
      expect(f.assertAuthority).toHaveBeenCalled();
    },
  );

  it.each(['database', 'pdf', 'missing', 'hardlink', 'signature'] as const)('rejects %s changes and leaves files alone', async kind => {
    const f = await fixture();
    if (kind === 'database') await fileSystem.writeFile(f.databasePath, Buffer.alloc(f.database.length, 65));
    if (kind === 'pdf') await fileSystem.writeFile(f.pdfPath, Buffer.alloc(f.pdf.length, 65));
    if (kind === 'missing') await fileSystem.unlink(f.pdfPath);
    if (kind === 'hardlink') await fileSystem.link(f.pdfPath, join(f.root, 'retained.pdf'));
    if (kind === 'signature') {
      const bytes = Buffer.alloc(f.pdf.length, 65);
      await fileSystem.writeFile(f.pdfPath, bytes);
      const documents = [{ ...f.input.result.documents[0]!, sha256: hash(bytes) }];
      f.input.result = { ...f.input.result, documents,
        receipt: { ...f.input.result.receipt, artifactIdentity: createProfileSnapshotArtifactIdentity(documents) } };
    }
    await expect(assertBytes(f.input)).rejects.toThrow();
    expect((await fileSystem.stat(f.root)).isDirectory()).toBe(true);
  });

  it('rejects a PDF changed during a later database read', async () => {
    const f = await fixture();
    const open = fileSystem.open.bind(fileSystem);
    vi.spyOn(fileSystem, 'open').mockImplementation(async (...args: Parameters<typeof fileSystem.open>) => {
      if (args[0] === f.databasePath) await fileSystem.writeFile(f.pdfPath, Buffer.alloc(f.pdf.length, 66));
      return open(...args);
    });
    await expect(assertBytes(f.input)).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
  });

  it('rebinds earlier bytes after the final awaited authority check', async () => {
    const f = await fixture();
    await expect(assertBytes({ ...f.input, async assertFinalAuthority() {
      await fileSystem.writeFile(f.pdfPath, Buffer.alloc(f.pdf.length, 66));
    } })).rejects.toThrow('PROFILE_INSPECTION_PROTOCOL_INVALID');
    expect(await fileSystem.readFile(f.databasePath)).toEqual(f.database);
  });

  it('does not fall back to files outside the canonical workspace runtime', async () => {
    const f = await fixture({ databaseSlot: 'active', documentsSlot: 'active' });
    const misplaced = join(f.input.sources.workspaceRoot, 'data', 'eky.sqlite');
    await fileSystem.mkdir(dirname(misplaced), { mode: 0o700 });
    await fileSystem.rename(f.databasePath, misplaced);
    const open = vi.spyOn(fileSystem, 'open');
    await expect(assertBytes(f.input)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(open).not.toHaveBeenCalledWith(misplaced, 'r');
    expect(await fileSystem.readFile(misplaced)).toEqual(f.database);
  });

  it('rejects unknown paths and a stale source pair before opening files', async () => {
    const f = await fixture();
    const open = vi.spyOn(fileSystem, 'open');
    await expect(assertBytes({ ...f.input, sources: { ...f.input.sources, databaseSlot: 'active' } })).rejects.toThrow();
    await expect(assertBytes({ ...f.input, result: { ...f.input.result,
      documents: [{ ...f.input.result.documents[0]!, storagePath: '../outside.pdf' }] } })).rejects.toThrow();
    expect(open).not.toHaveBeenCalled();
  });

  it('does not scan or adopt unselected documents', async () => {
    const f = await fixture();
    const extra = join(dirname(f.pdfPath), 'unselected.pdf');
    await fileSystem.writeFile(extra, 'not a PDF');
    await assertBytes(f.input);
    expect(await fileSystem.readFile(extra, 'utf8')).toBe('not a PDF');
  });

  it('bounds cancellation and an expired deadline without file mutation', async () => {
    const f = await fixture();
    await expect(assertBytes({ ...f.input, deadline: performance.now() - 1 })).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    f.cancellation.abort();
    await expect(assertBytes(f.input)).rejects.toThrow('PROFILE_INSPECTION_TIMEOUT');
    expect(await fileSystem.readFile(f.databasePath)).toEqual(f.database);
  });
});

async function fixture(slots: Pick<ProfileInspectionColdSources, 'databaseSlot' | 'documentsSlot'> = {
  databaseSlot: 'staged', documentsSlot: 'staged',
}) {
  const root = await fileSystem.mkdtemp(join(tmpdir(), 'eky-cold-source-bytes-'));
  roots.push(root);
  const workspaceRoot = join(root, 'workspace');
  const operationRoot = join(root, 'staging', randomUUID());
  const activePaths = createDesktopProfilePaths(workspaceRoot);
  const databasePath = slots.databaseSlot === 'active' ? activePaths.databaseFilePath : join(operationRoot, 'profile.sqlite');
  const documentsRoot = slots.documentsSlot === 'active' ? activePaths.invoiceDocumentStorageRoot : join(operationRoot, 'activation', 'storage', 'invoices');
  const pdfPath = join(documentsRoot, 'company', 'invoice', 'document.pdf');
  for (const path of [workspaceRoot, operationRoot, dirname(databasePath), documentsRoot, dirname(pdfPath)])
    await fileSystem.mkdir(path, { recursive: true, mode: 0o700 });
  const database = Buffer.from('synthetic database file, intentionally never opened as SQLite');
  const pdf = Buffer.from('%PDF-1.7 synthetic');
  await fileSystem.writeFile(databasePath, database);
  await fileSystem.writeFile(pdfPath, pdf);
  const documents = [{ storagePath: 'company/invoice/document.pdf',
    logicalPath: `artifacts/invoicing/invoice-documents/${'a'.repeat(64)}.pdf`, byteSize: pdf.length, sha256: hash(pdf) }];
  const result: ProfileRestoreColdInspectionResult = { documents,
    receipt: { ...slots, profileId: 'b'.repeat(64), databaseHealth: 'healthy', migrationPolicy: 'restoreCompatible',
      migrationChainIdentity: 'c'.repeat(64), artifactCount: 1, artifactTotalByteSize: pdf.length,
      artifactIdentity: createProfileSnapshotArtifactIdentity(documents),
      database: { byteSize: database.length, sha256: hash(database) }, documentBindings: { byteSize: 34, sha256: 'd'.repeat(64) } } };
  const cancellation = new AbortController();
  const assertAuthority = vi.fn(() => {});
  return { root, databasePath, pdfPath, database, pdf, cancellation, assertAuthority,
    input: { operationRoot, sources: { workspaceRoot, ...slots }, result, signal: cancellation.signal,
      deadline: performance.now() + 35_000, assertAuthority } };
}
function hash(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
