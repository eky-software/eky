import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { getApprovedInvoicePdfDocument, type GetApprovedInvoicePdfDocumentDependencies } from './getApprovedInvoicePdfDocument.js';

export interface GetApprovedInvoicePdfMetadataInput {
  companyId: string;
  invoiceId: string;
}

export async function getApprovedInvoicePdfMetadata(
  input: GetApprovedInvoicePdfMetadataInput,
  dependencies: GetApprovedInvoicePdfDocumentDependencies,
): Promise<ApprovedInvoiceDocumentMetadata> {
  return (await getApprovedInvoicePdfDocument(input, dependencies)).metadata;
}
