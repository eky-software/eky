import { createHash, randomUUID } from 'node:crypto';

import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceDocumentRepository } from '../ports/invoiceDocumentRepository.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';

const approvedInvoicePdfDocumentType = 'approved_invoice_pdf';

export interface GenerateApprovedInvoicePdfDocumentInput {
  companyId: string;
  createdAt: string;
  invoiceId: string;
}

export interface GenerateApprovedInvoicePdfDocumentDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  invoiceDocumentRepository: InvoiceDocumentRepository;
  invoiceDocumentStorage: InvoiceDocumentStorage;
  renderApprovedInvoicePdf(invoice: ApprovedInvoiceView): Promise<Uint8Array>;
}

export async function generateApprovedInvoicePdfDocument(
  input: GenerateApprovedInvoicePdfDocumentInput,
  dependencies: GenerateApprovedInvoicePdfDocumentDependencies,
): Promise<ApprovedInvoiceDocumentMetadata> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const createdAt = requireIdentifier(input.createdAt, 'Document timestamp');

  const existingDocument =
    await dependencies.invoiceDocumentRepository.findDocumentForInvoice(
      companyId,
      invoiceId,
      approvedInvoicePdfDocumentType,
    );

  if (existingDocument !== undefined) {
    try {
      await dependencies.invoiceDocumentStorage.readFile(
        existingDocument.storagePath,
      );

      return existingDocument;
    } catch {
      await dependencies.invoiceDocumentRepository.deleteDocumentsForInvoice(
        companyId,
        invoiceId,
        approvedInvoicePdfDocumentType,
      );
    }
  }

  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  const pdfContent = await dependencies.renderApprovedInvoicePdf(invoice);
  const metadata: ApprovedInvoiceDocumentMetadata = {
    id: randomUUID(),
    companyId,
    invoiceId,
    documentType: approvedInvoicePdfDocumentType,
    fileName: `lasku-${invoice.invoiceNumber}.pdf`,
    storagePath: createApprovedInvoicePdfStoragePath(companyId, invoiceId),
    mimeType: 'application/pdf',
    sha256: createSha256(pdfContent),
    sizeBytes: pdfContent.byteLength,
    createdAt,
  };

  await dependencies.invoiceDocumentStorage.writeFile(
    metadata.storagePath,
    pdfContent,
  );

  try {
    return await dependencies.invoiceDocumentRepository.saveDocument(metadata);
  } catch (error) {
    await dependencies.invoiceDocumentStorage
      .deleteFile(metadata.storagePath)
      .catch(() => undefined);

    throw error;
  }
}

function createApprovedInvoicePdfStoragePath(
  companyId: string,
  invoiceId: string,
): string {
  return `${encodeURIComponent(companyId)}/${encodeURIComponent(
    invoiceId,
  )}/approved-invoice.pdf`;
}

function createSha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
