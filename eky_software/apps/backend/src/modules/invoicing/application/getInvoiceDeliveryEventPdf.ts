import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceDocumentStorage } from '../ports/invoiceDocumentStorage.js';
import { ApprovedInvoiceDocumentNotFoundError } from './approvedInvoiceDocumentNotFoundError.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import type { StoredInvoiceDocumentFile } from './readStoredInvoiceDocument.js';

export interface GetInvoiceDeliveryEventPdfInput {
  actorContext: ActorContext;
  invoiceId: string;
  eventId: string;
}

export type InvoiceDeliveryEventPdfResult =
  | Readonly<{ kind: 'document'; file: StoredInvoiceDocumentFile }>
  | Readonly<{ kind: 'legacyMissingDocument' }>;

export async function getInvoiceDeliveryEventPdf(
  input: GetInvoiceDeliveryEventPdfInput,
  dependencies: {
    invoiceDeliveryEventReader: Pick<InvoiceDeliveryEventReader, 'findEventDocument'>;
    invoiceDocumentStorage: Pick<InvoiceDocumentStorage, 'readVerifiedDocument'>;
  },
): Promise<InvoiceDeliveryEventPdfResult> {
  requirePermission(input.actorContext, 'sendInvoices');
  const scope = {
    companyId: requireIdentifier(input.actorContext.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.invoiceId, 'Invoice id'),
  };
  const eventId = requireIdentifier(input.eventId, 'Delivery event id');
  const result = await dependencies.invoiceDeliveryEventReader.findEventDocument(scope, eventId);
  if (result === undefined) throw new ApprovedInvoiceDocumentNotFoundError();
  if (result.kind === 'legacyMissingDocument') return result;
  const metadata = result.document;
  if (metadata.companyId !== scope.companyId || metadata.invoiceId !== scope.invoiceId) {
    throw new InvoiceDocumentIntegrityError();
  }
  try {
    const content = await dependencies.invoiceDocumentStorage.readVerifiedDocument(metadata);
    return { kind: 'document', file: { content, metadata } };
  } catch {
    throw new InvoiceDocumentIntegrityError();
  }
}
