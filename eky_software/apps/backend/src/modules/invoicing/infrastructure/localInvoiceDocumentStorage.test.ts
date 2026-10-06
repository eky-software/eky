import { lstat, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { invoiceDocumentMaximumSizeBytes } from './invoiceDocumentFilePolicy.js';
import {
  createPdfContent, createStorageFixture, evidenceFor, expectIntegrityFailure,
  snapshotStorageTree, storageTestScope,
} from './localInvoiceDocumentStorage.fixture.js';
import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';

describe('LocalInvoiceDocumentStorage', () => {
  it.each(['existing', 'nested-missing'] as const)('writes exact independent bytes under an explicit %s root', async (kind) => {
    const fixture = await createStorageFixture();
    const root = kind === 'existing' ? fixture.storageRoot : join(fixture.testRoot, 'nested', 'new', 'invoices');
    const storage = new LocalInvoiceDocumentStorage(root);
    const content = await readFile(fixture.sourcePath);
    const candidate = await storage.writeCandidate({ scope: storageTestScope, documentId: 'document-1', content });
    const expectedPath = 'id-company-1/id-invoice-1/id-document-1/approved-invoice.pdf';
    const filePath = join(root, ...expectedPath.split('/'));

    expect(candidate).toMatchObject(evidenceFor(expectedPath, content));
    await expect(readFile(filePath)).resolves.toEqual(content);
    expect(Buffer.from(await storage.readVerifiedDocument(candidate))).toEqual(content);
    const source = await lstat(fixture.sourcePath, { bigint: true });
    const stored = await lstat(filePath, { bigint: true });
    expect(stored.isFile()).toBe(true);
    expect(stored.nlink).toBe(1n);
    expect(source.nlink).toBe(1n);
    expect(stored.ino).not.toBe(source.ino);

    await writeFile(fixture.sourcePath, createPdfContent('source changed'));
    await expect(readFile(filePath)).resolves.toEqual(content);
  });

  it('rejects storage paths that escape the configured storage root', async () => {
    const fixture = await createStorageFixture();
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument(
      evidenceFor('../outside/source.pdf', createPdfContent()),
    ));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it('captures a caller buffer view before the first await and returns independent read buffers', async () => {
    const fixture = await createStorageFixture();
    const expected = createPdfContent();
    const backing = Buffer.concat([Buffer.from('prefix'), expected, Buffer.from('suffix')]);
    const content = backing.subarray(6, 6 + expected.byteLength);
    const pending = fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'capture', content });
    content.fill(0);
    const candidate = await pending;

    expect(candidate).toMatchObject(evidenceFor(candidate.storagePath, expected));
    await expect(readFile(fixture.absolutePath(candidate.storagePath))).resolves.toEqual(expected);
    const firstRead = await fixture.storage.readVerifiedDocument(candidate);
    firstRead.fill(0);
    expect(Buffer.from(await fixture.storage.readVerifiedDocument(candidate))).toEqual(expected);
  });

  it('preserves the existing file on a same-ID exclusive-write collision', async () => {
    const fixture = await createStorageFixture();
    const candidate = await fixture.storage.writeCandidate({
      scope: storageTestScope, documentId: 'same-id', content: createPdfContent('winner'),
    });
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(new LocalInvoiceDocumentStorage(fixture.storageRoot).writeCandidate({
      scope: storageTestScope, documentId: 'same-id', content: createPdfContent('collision'),
    }));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
    expect(Buffer.from(await fixture.storage.readVerifiedDocument(candidate))).toEqual(createPdfContent('winner'));
  });

  it('gives distinct writers independent paths and discards only the losing candidate', async () => {
    const fixture = await createStorageFixture();
    const [winner, loser] = await Promise.all([
      fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'winner', content: createPdfContent('winner') }),
      new LocalInvoiceDocumentStorage(fixture.storageRoot).writeCandidate({
        scope: storageTestScope, documentId: 'loser', content: createPdfContent('loser'),
      }),
    ]);
    expect(loser.storagePath).not.toBe(winner.storagePath);
    const winnerPath = fixture.absolutePath(winner.storagePath);
    const before = await lstat(winnerPath, { bigint: true });
    await loser.discard();

    await expect(lstat(fixture.absolutePath(loser.storagePath))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await lstat(winnerPath, { bigint: true })).toMatchObject({ ino: before.ino, nlink: 1n, size: before.size });
    expect(Buffer.from(await fixture.storage.readVerifiedDocument(winner))).toEqual(createPdfContent('winner'));
  });

  it('shares concurrent discard work and cannot delete a later same-path replacement', async () => {
    const fixture = await createStorageFixture();
    const candidate = await fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'discard', content: createPdfContent() });
    const first = candidate.discard();
    const second = candidate.discard();
    expect(second).toBe(first);
    await Promise.all([first, second]);
    const filePath = fixture.absolutePath(candidate.storagePath);
    await expect(lstat(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await writeFile(filePath, createPdfContent('replacement'), { flag: 'wx' });
    const before = await snapshotStorageTree(fixture.testRoot);
    await candidate.discard();
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it('treats a missing owned candidate as an idempotent discard without deleting a later replacement', async () => {
    const fixture = await createStorageFixture();
    const candidate = await fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'missing', content: createPdfContent() });
    const filePath = fixture.absolutePath(candidate.storagePath);
    await unlink(filePath);
    await candidate.discard();
    await writeFile(filePath, createPdfContent('replacement'), { flag: 'wx' });
    const before = await snapshotStorageTree(fixture.testRoot);
    await candidate.discard();
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it.each(['same-bytes-replacement', 'mutated-bytes'] as const)('refuses to discard a %s and retains both evidence and replacement', async (kind) => {
    const fixture = await createStorageFixture();
    const content = createPdfContent();
    const candidate = await fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'changed', content });
    const filePath = fixture.absolutePath(candidate.storagePath);
    if (kind === 'same-bytes-replacement') {
      // Keep the old file alive so identity reuse cannot make this test timing-dependent.
      await rename(filePath, join(fixture.outsideRoot, 'original-candidate.pdf'));
      await writeFile(filePath, content, { flag: 'wx' });
    } else {
      const changed = Buffer.from(content);
      changed[changed.byteLength - 2] = 0;
      await writeFile(filePath, changed);
    }
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(candidate.discard());
    await expectIntegrityFailure(candidate.discard());
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it('reads an original legacy relative path only against its actual hash and size', async () => {
    const fixture = await createStorageFixture();
    const content = createPdfContent('legacy');
    const document = await fixture.writeLegacy('dev-company/invoice-1/approved-invoice.pdf', content);
    const before = await snapshotStorageTree(fixture.testRoot);
    expect(Buffer.from(await fixture.storage.readVerifiedDocument(document))).toEqual(content);
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument({ ...document, sha256: '0'.repeat(64) }));
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument({ ...document, sizeBytes: document.sizeBytes + 1 }));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it('accepts the central maximum exactly and rejects one extra byte before writing', async () => {
    const fixture = await createStorageFixture();
    const content = Buffer.alloc(invoiceDocumentMaximumSizeBytes);
    content.set(createPdfContent());
    const candidate = await fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'maximum', content });
    expect(candidate).toMatchObject(evidenceFor(candidate.storagePath, content));
    const read = Buffer.from(await fixture.storage.readVerifiedDocument(candidate));
    expect(read.byteLength).toBe(content.byteLength);
    expect(read.equals(content)).toBe(true);
    const before = await snapshotStorageTree(fixture.testRoot);
    const oversized = Buffer.concat([content, Buffer.from([0])]);
    await expectIntegrityFailure(fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'oversized', content: oversized }));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it('encodes hostile identifiers as contained segments without interpreting them as paths', async () => {
    const fixture = await createStorageFixture();
    const outsideBefore = await snapshotStorageTree(fixture.outsideRoot);
    const candidate = await fixture.storage.writeCandidate({
      scope: { companyId: '..', invoiceId: 'CON' }, documentId: '../A\\B:*?.', content: createPdfContent(),
    });
    expect(candidate.storagePath).toBe('id-%2E%2E/id-CON/id-%2E%2E%2FA%5CB%3A%2A%3F%2E/approved-invoice.pdf');
    expect(Buffer.from(await fixture.storage.readVerifiedDocument(candidate))).toEqual(createPdfContent());
    expect(await snapshotStorageTree(fixture.outsideRoot)).toEqual(outsideBefore);
    expect((await readdir(fixture.testRoot)).sort()).toEqual(['outside', 'storage']);
  });
});
