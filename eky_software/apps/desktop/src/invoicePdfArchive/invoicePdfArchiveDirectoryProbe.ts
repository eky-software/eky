import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { requireExistingDirectory } from './invoicePdfArchiveConfig.js';
import {
  finalizeInvoicePdfArchiveFile,
  type InvoicePdfArchiveFileOperations,
} from './invoicePdfArchiveFileFinalization.js';
import { InvoicePdfArchiveError } from './invoicePdfArchiveTypes.js';

const probeContent = Uint8Array.from(
  Buffer.from('Eky invoice PDF archive capability probe\n', 'utf8'),
);

export async function probeInvoicePdfArchiveDirectory(
  directoryPath: string,
  operationOverrides: Partial<InvoicePdfArchiveFileOperations> = {},
): Promise<void> {
  const verifiedDirectoryPath = await requireExistingDirectory(directoryPath);
  const probeId = randomUUID();
  const finalPath = join(
    verifiedDirectoryPath,
    `.eky-invoice-pdf-probe-${probeId}.probe`,
  );
  const temporaryPath = join(
    verifiedDirectoryPath,
    `.eky-invoice-pdf-probe-${probeId}.next`,
  );
  const remove = operationOverrides.rm ?? rm;

  try {
    await finalizeInvoicePdfArchiveFile(
      {
        content: probeContent,
        finalPath,
        temporaryPath,
      },
      operationOverrides,
    );
    await remove(finalPath, { force: true });
  } catch {
    throw new InvoicePdfArchiveError(
      'ARCHIVE_DIRECTORY_UNSUPPORTED',
      false,
    );
  } finally {
    await remove(temporaryPath, { force: true }).catch(() => undefined);
    await remove(finalPath, { force: true }).catch(() => undefined);
  }
}
