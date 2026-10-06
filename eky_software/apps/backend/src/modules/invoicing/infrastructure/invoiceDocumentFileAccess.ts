import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, type FileHandle } from 'node:fs/promises';

import { InvoiceDocumentIntegrityError } from '../application/invoiceDocumentIntegrityError.js';
import type { InvoiceDocumentFileEvidence } from '../ports/invoiceDocumentStorage.js';
import { invoiceDocumentMaximumSizeBytes, invoiceDocumentPdfSignature } from './invoiceDocumentFilePolicy.js';
import {
  assertInvoiceDocumentPathUnchanged, sameInvoiceDocumentFile,
  type InvoiceDocumentPathAccess,
} from './invoiceDocumentPathAccess.js';

export function validateInvoiceDocumentBytes(content: Uint8Array): void {
  if (content.byteLength < invoiceDocumentPdfSignature.length
    || content.byteLength > invoiceDocumentMaximumSizeBytes
    || !Buffer.from(content.subarray(0, invoiceDocumentPdfSignature.length)).equals(Buffer.from(invoiceDocumentPdfSignature, 'ascii'))) {
    throw new InvoiceDocumentIntegrityError();
  }
}

export function invoiceDocumentHash(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}

export function validateInvoiceDocumentFileEvidence(evidence: InvoiceDocumentFileEvidence): void {
  if (!Number.isSafeInteger(evidence.sizeBytes)
    || evidence.sizeBytes < invoiceDocumentPdfSignature.length
    || evidence.sizeBytes > invoiceDocumentMaximumSizeBytes
    || !/^[a-f0-9]{64}$/u.test(evidence.sha256)) {
    throw new InvoiceDocumentIntegrityError();
  }
}

export async function readVerifiedInvoiceDocumentFile(
  access: InvoiceDocumentPathAccess,
  evidence: InvoiceDocumentFileEvidence,
): Promise<{ content: Uint8Array; identity: BigIntStats }> {
  validateInvoiceDocumentFileEvidence(evidence);
  await assertInvoiceDocumentPathUnchanged(access);
  const before = await lstat(access.filePath, { bigint: true });
  assertRegularSingleLinkFile(before, evidence.sizeBytes);
  const handle = await open(access.filePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = await handle.stat({ bigint: true });
    assertRegularSingleLinkFile(opened, evidence.sizeBytes);
    if (!sameInvoiceDocumentFile(before, opened)) throw new InvoiceDocumentIntegrityError();
    const content = await readBounded(handle, evidence.sizeBytes);
    const after = await handle.stat({ bigint: true });
    assertRegularSingleLinkFile(after, evidence.sizeBytes);
    if (!sameInvoiceDocumentFile(opened, after)
      || opened.mtimeNs !== after.mtimeNs || opened.ctimeNs !== after.ctimeNs) {
      throw new InvoiceDocumentIntegrityError();
    }
    await assertInvoiceDocumentPathUnchanged(access);
    const current = await lstat(access.filePath, { bigint: true });
    assertRegularSingleLinkFile(current, evidence.sizeBytes);
    if (!sameInvoiceDocumentFile(after, current)) throw new InvoiceDocumentIntegrityError();
    validateInvoiceDocumentBytes(content);
    if (invoiceDocumentHash(content) !== evidence.sha256) throw new InvoiceDocumentIntegrityError();
    return { content, identity: after };
  } finally {
    await handle.close();
  }
}

export function assertRegularSingleLinkFile(metadata: BigIntStats, expectedSize?: number): void {
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n
    || (expectedSize !== undefined && metadata.size !== BigInt(expectedSize))) {
    throw new InvoiceDocumentIntegrityError();
  }
}

async function readBounded(handle: FileHandle, expectedSize: number): Promise<Uint8Array> {
  // One extra byte detects growth without allowing an unbounded file read.
  const buffer = Buffer.alloc(expectedSize + 1);
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.byteLength - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  if (offset !== expectedSize) throw new InvoiceDocumentIntegrityError();
  return buffer.subarray(0, expectedSize);
}
