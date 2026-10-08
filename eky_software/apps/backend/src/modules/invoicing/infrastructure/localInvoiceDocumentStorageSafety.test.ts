import { link, lstat, mkdir, readFile, rename, symlink, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { createInvoiceDocumentStoragePath, invoiceDocumentMaximumSizeBytes } from './invoiceDocumentFilePolicy.js';
import * as pathAccess from './invoiceDocumentPathAccess.js';
import {
  createPdfContent, createStorageFixture, evidenceFor, expectIntegrityFailure,
  snapshotStorageTree, storageTestScope,
} from './localInvoiceDocumentStorage.fixture.js';
import { LocalInvoiceDocumentStorage } from './localInvoiceDocumentStorage.js';

describe('LocalInvoiceDocumentStorage filesystem safety', () => {
  it.each(['missing', 'truncated', 'oversized', 'changed', 'signature', 'directory'] as const)(
    'rejects a %s stored document without modifying the isolated tree', async (kind) => {
      const fixture = await createStorageFixture();
      const original = createPdfContent();
      const document = await fixture.writeLegacy();
      const filePath = fixture.absolutePath(document.storagePath);
      if (kind === 'missing' || kind === 'directory') {
        await unlink(filePath);
        if (kind === 'directory') await mkdir(filePath);
      } else {
        const changed = kind === 'truncated' ? original.subarray(0, original.byteLength - 1)
          : kind === 'oversized' ? Buffer.alloc(invoiceDocumentMaximumSizeBytes + 1) : Buffer.from(original);
        if (kind === 'changed') changed[changed.byteLength - 2] = 0;
        if (kind === 'signature') changed[0] = 0;
        await writeFile(filePath, changed);
      }
      const before = await snapshotStorageTree(fixture.testRoot);
      await expectIntegrityFailure(fixture.storage.readVerifiedDocument(document));
      expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
    },
  );

  it.each(['empty', 'short-prefix', 'non-pdf', 'high-bit-prefix'] as const)(
    'rejects %s bytes on write and read even when the supplied hash and size match', async (kind) => {
      const fixture = await createStorageFixture();
      const content = kind === 'empty' ? Buffer.alloc(0) : kind === 'short-prefix' ? Buffer.from('%PDF')
        : kind === 'non-pdf' ? Buffer.from('not a PDF file') : createPdfContent();
      if (kind === 'high-bit-prefix') {
        content.set([0xa5, 0xd0, 0xc4, 0xc6, 0xad]);
      }
      const document = await fixture.writeLegacy('legacy/document.pdf', content);
      const before = await snapshotStorageTree(fixture.testRoot);
      await expectIntegrityFailure(fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'invalid', content }));
      await expectIntegrityFailure(fixture.storage.readVerifiedDocument(document));
      expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
    },
  );

  it.each([
    { sha256: '' }, { sha256: '0'.repeat(63) }, { sha256: 'g'.repeat(64) }, { sha256: 'A'.repeat(64) },
    { sizeBytes: -1 }, { sizeBytes: 0 }, { sizeBytes: 4 }, { sizeBytes: 5.5 },
    { sizeBytes: Number.NaN }, { sizeBytes: Number.POSITIVE_INFINITY },
    { sizeBytes: invoiceDocumentMaximumSizeBytes + 1 },
  ])('rejects invalid expected metadata (%#) without altering the file', async (invalid) => {
    const fixture = await createStorageFixture();
    const document = await fixture.writeLegacy();
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument({ ...document, ...invalid }));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it.each([
    '../outside/source.pdf', 'legacy/../../outside/source.pdf', '/outside/source.pdf',
    'C:/outside/source.pdf', 'C:\\outside\\source.pdf', '\\\\server\\share\\source.pdf',
    '//server/share/source.pdf', '\\\\?\\C:\\outside\\source.pdf',
    './legacy/document.pdf', 'legacy/./document.pdf', 'legacy/../document.pdf',
    'legacy//document.pdf', 'legacy\\document.pdf', 'legacy/document.pdf:stream',
    'legacy/document.pdf.', 'legacy/document.pdf ', 'legacy./document.pdf', 'legacy /document.pdf',
    'legacy/CON.pdf', 'legacy/COM1/document.pdf', 'legacy/aux/document.pdf',
    'legacy/NUL', 'legacy/LPT9.txt', 'legacy/document?.pdf', 'legacy/document\u0000.pdf',
  ])('rejects traversal, absolute or Windows-alias storage paths (%#)', async (storagePath) => {
    const fixture = await createStorageFixture();
    await fixture.writeLegacy('legacy/document.pdf');
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument(evidenceFor(storagePath, createPdfContent())));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it('rejects a real absolute path to an existing external synthetic PDF', async () => {
    const fixture = await createStorageFixture();
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument(evidenceFor(fixture.sourcePath, createPdfContent())));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it.each(['symlink', 'hardlink'] as const)('rejects a final-file %s on read and collision without changing its target', async (kind) => {
    const fixture = await createStorageFixture();
    const storagePath = createInvoiceDocumentStoragePath(storageTestScope, 'linked');
    const filePath = fixture.absolutePath(storagePath);
    await mkdir(dirname(filePath), { recursive: true });
    if (kind === 'symlink') await symlink(fixture.sourcePath, filePath, 'file');
    else await link(fixture.sourcePath, filePath);
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(fixture.storage.readVerifiedDocument(evidenceFor(storagePath, createPdfContent())));
    await expectIntegrityFailure(fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'linked', content: createPdfContent('new') }));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it.each([
    { location: 'root', type: 'junction' },
    { location: 'parent', type: 'junction' },
    { location: 'root-ancestor', type: 'junction' },
    { location: 'parent', type: 'dir' },
  ] as const)('rejects a $location $type on read and write without traversing it', async ({ location, type }) => {
    const fixture = await createStorageFixture();
    const storagePath = createInvoiceDocumentStoragePath(storageTestScope, 'linked');
    let root = fixture.storageRoot;
    let target: string;
    if (location === 'parent') {
      await symlink(fixture.outsideRoot, join(root, 'id-company-1'), type);
      target = join(fixture.outsideRoot, 'id-invoice-1', 'id-linked', 'approved-invoice.pdf');
    } else if (location === 'root') {
      root = join(fixture.testRoot, 'linked-root');
      await symlink(fixture.outsideRoot, root, type);
      target = join(fixture.outsideRoot, ...storagePath.split('/'));
    } else {
      const linkedAncestor = join(fixture.testRoot, 'linked-ancestor');
      await symlink(fixture.outsideRoot, linkedAncestor, type);
      await mkdir(join(fixture.outsideRoot, 'nested'));
      root = join(linkedAncestor, 'nested');
      target = join(fixture.outsideRoot, 'nested', ...storagePath.split('/'));
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, createPdfContent(), { flag: 'wx' });
    const before = await snapshotStorageTree(fixture.testRoot);
    const storage = new LocalInvoiceDocumentStorage(root);
    await expectIntegrityFailure(storage.readVerifiedDocument(evidenceFor(storagePath, createPdfContent())));
    await expectIntegrityFailure(storage.writeCandidate({ scope: storageTestScope, documentId: 'linked', content: createPdfContent('new') }));
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it.each(['symlink', 'hardlink', 'parent-junction'] as const)('refuses discard after a %s substitution', async (kind) => {
    const fixture = await createStorageFixture();
    const candidate = await fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'discard-link', content: createPdfContent() });
    const filePath = fixture.absolutePath(candidate.storagePath);
    if (kind === 'parent-junction') {
      const parent = dirname(filePath);
      const moved = join(fixture.outsideRoot, 'moved-parent');
      await rename(parent, moved);
      await symlink(moved, parent, 'junction');
    } else {
      await rename(filePath, join(fixture.outsideRoot, 'original-candidate.pdf'));
      if (kind === 'symlink') await symlink(fixture.sourcePath, filePath, 'file');
      else await link(fixture.sourcePath, filePath);
    }
    const before = await snapshotStorageTree(fixture.testRoot);
    await expectIntegrityFailure(candidate.discard());
    expect(await snapshotStorageTree(fixture.testRoot)).toEqual(before);
  });

  it.each(['file', 'parent'] as const)('rejects a deterministic same-byte %s swap during a real read', async (kind) => {
    const fixture = await createStorageFixture();
    const document = await fixture.writeLegacy();
    const filePath = fixture.absolutePath(document.storagePath);
    const originalCheck = pathAccess.assertInvoiceDocumentPathUnchanged;
    let checks = 0;
    let swapError: unknown;
    let afterSwap: Awaited<ReturnType<typeof snapshotStorageTree>> | undefined;
    const check = vi.spyOn(pathAccess, 'assertInvoiceDocumentPathUnchanged').mockImplementation(async (access) => {
      checks += 1;
      // The second check follows the real bounded read; never replace a validation result.
      if (checks === 2) {
        try {
          const parkedFile = join(fixture.outsideRoot, 'original.pdf');
          await rename(filePath, parkedFile);
          if (kind === 'file') {
            await writeFile(filePath, createPdfContent(), { flag: 'wx' });
          } else {
            // Move the open file first, then restore it into a new parent directory.
            const identity = await lstat(parkedFile, { bigint: true });
            await rename(dirname(filePath), join(fixture.outsideRoot, 'original-parent'));
            await mkdir(dirname(filePath));
            await rename(parkedFile, filePath);
            expect(await lstat(filePath, { bigint: true })).toMatchObject({ ino: identity.ino, dev: identity.dev });
          }
          afterSwap = await snapshotStorageTree(fixture.testRoot);
        } catch (error) {
          swapError = error;
          throw error;
        }
      }
      await originalCheck(access);
    });
    try {
      await expectIntegrityFailure(fixture.storage.readVerifiedDocument(document));
      expect(checks).toBe(2);
      expect(swapError).toBeUndefined();
      expect(afterSwap).toBeDefined();
      expect(await snapshotStorageTree(fixture.testRoot)).toEqual(afterSwap);
    } finally {
      check.mockRestore();
    }
  });

  it.each(['before-write', 'after-write'] as const)('retains the unowned outcome of a %s failure without arbitrary cleanup', async (stage) => {
    const fixture = await createStorageFixture();
    const outsideBefore = await snapshotStorageTree(fixture.outsideRoot);
    const originalCheck = pathAccess.assertInvoiceDocumentPathUnchanged;
    let checks = 0;
    const check = vi.spyOn(pathAccess, 'assertInvoiceDocumentPathUnchanged').mockImplementation(async (access) => {
      await originalCheck(access);
      checks += 1;
      if (checks === (stage === 'before-write' ? 1 : 2)) throw new Error('Synthetic write outcome failure');
    });
    try {
      await expectIntegrityFailure(fixture.storage.writeCandidate({ scope: storageTestScope, documentId: 'failed', content: createPdfContent() }));
      expect(checks).toBe(stage === 'before-write' ? 1 : 2);
      const filePath = fixture.absolutePath(createInvoiceDocumentStoragePath(storageTestScope, 'failed'));
      await expect(readFile(filePath)).resolves.toEqual(stage === 'before-write' ? Buffer.alloc(0) : createPdfContent());
      expect((await lstat(filePath)).nlink).toBe(1);
      expect(await snapshotStorageTree(fixture.outsideRoot)).toEqual(outsideBefore);
    } finally {
      check.mockRestore();
    }
  });
});
