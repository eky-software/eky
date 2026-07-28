import type { InvoiceDocumentStorage } from '../src/modules/invoicing/ports/invoiceDocumentStorage.js';
import { LocalInvoiceDocumentStorage } from '../src/modules/invoicing/infrastructure/localInvoiceDocumentStorage.js';
import type { E2eFaultPlan } from './e2eBackendConfig.js';

export function createE2eInvoiceDocumentStorage(
  rootPath: string,
  faultPlan: E2eFaultPlan,
): InvoiceDocumentStorage {
  const storage = new LocalInvoiceDocumentStorage(rootPath);
  if (faultPlan.kind !== 'pdfStorageWriteFailed') {
    return storage;
  }

  return {
    deleteFile: (storagePath) => storage.deleteFile(storagePath),
    readFile: (storagePath) => storage.readFile(storagePath),
    async writeFile() {
      throw new Error('E2E PDF storage write failed.');
    },
  };
}
