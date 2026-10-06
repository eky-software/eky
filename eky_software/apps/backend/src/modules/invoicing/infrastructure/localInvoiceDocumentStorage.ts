import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';

import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type {
  InvoiceDocumentFileCandidate, InvoiceDocumentFileEvidence, InvoiceDocumentStorage,
} from '../ports/invoiceDocumentStorage.js';
import {
  assertRegularSingleLinkFile, invoiceDocumentHash, readVerifiedInvoiceDocumentFile,
  validateInvoiceDocumentBytes, validateInvoiceDocumentFileEvidence,
} from './invoiceDocumentFileAccess.js';
import { createInvoiceDocumentStoragePath } from './invoiceDocumentFilePolicy.js';
import {
  assertInvoiceDocumentPathUnchanged, hasFileErrorCode, inspectInvoiceDocumentPath,
  sameInvoiceDocumentFile, type InvoiceDocumentPathAccess,
} from './invoiceDocumentPathAccess.js';

const defaultStorageRoot = 'storage/invoices';

export class LocalInvoiceDocumentStorage implements InvoiceDocumentStorage {
  private readonly rootPath: string;

  constructor(rootPath = resolve(process.cwd(), defaultStorageRoot)) {
    this.rootPath = resolve(rootPath);
  }

  async readVerifiedDocument(document: InvoiceDocumentFileEvidence): Promise<Uint8Array> {
    try {
      const evidence = { storagePath: document.storagePath, sha256: document.sha256, sizeBytes: document.sizeBytes };
      validateInvoiceDocumentFileEvidence(evidence);
      const access = await inspectInvoiceDocumentPath(this.rootPath, evidence.storagePath);
      return (await readVerifiedInvoiceDocumentFile(access, evidence)).content;
    } catch {
      throw new InvoiceDocumentIntegrityError();
    }
  }

  async writeCandidate(input: Parameters<InvoiceDocumentStorage['writeCandidate']>[0]): Promise<InvoiceDocumentFileCandidate> {
    try {
      validateInvoiceDocumentBytes(input.content);
      // Snapshot before the first await; callers cannot mutate the stored bytes.
      const content = Buffer.from(input.content);
      const evidence = Object.freeze({
        storagePath: createInvoiceDocumentStoragePath(input.scope, input.documentId),
        sha256: invoiceDocumentHash(content),
        sizeBytes: content.byteLength,
      });
      const access = await inspectInvoiceDocumentPath(this.rootPath, evidence.storagePath, true);
      const handle = await open(access.filePath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      const identity = await handle.stat({ bigint: true }).catch(async (error: unknown) => {
        await handle.close();
        throw error;
      });
      try {
        assertRegularSingleLinkFile(identity, 0);
        await assertInvoiceDocumentPathUnchanged(access);
        await handle.writeFile(content);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const verified = await readVerifiedInvoiceDocumentFile(access, evidence);
      if (!sameInvoiceDocumentFile(identity, verified.identity)) throw new InvoiceDocumentIntegrityError();
      let discardPromise: Promise<void> | undefined;
      return Object.freeze({
        ...evidence,
        discard: () => discardPromise ??= discardOwnedCandidate(access, evidence, identity),
      });
    } catch {
      // Unknown/partial write outcomes are retained; no shared-path fallback cleanup.
      throw new InvoiceDocumentIntegrityError();
    }
  }
}

async function discardOwnedCandidate(
  access: InvoiceDocumentPathAccess,
  evidence: InvoiceDocumentFileEvidence,
  identity: BigIntStats,
): Promise<void> {
  try {
    await assertInvoiceDocumentPathUnchanged(access);
    try { await lstat(access.filePath); } catch (error) {
      if (hasFileErrorCode(error, 'ENOENT')) return;
      throw error;
    }
    const current = await readVerifiedInvoiceDocumentFile(access, evidence);
    if (!sameInvoiceDocumentFile(identity, current.identity)) throw new InvoiceDocumentIntegrityError();
    await assertInvoiceDocumentPathUnchanged(access);
    const last = await lstat(access.filePath, { bigint: true });
    assertRegularSingleLinkFile(last, evidence.sizeBytes);
    if (!sameInvoiceDocumentFile(identity, last)) throw new InvoiceDocumentIntegrityError();
    await unlink(access.filePath);
  } catch {
    throw new InvoiceDocumentIntegrityError();
  }
}
