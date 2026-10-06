import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';

export interface ListInvoiceDeliveryEventsInput {
  actorContext: ActorContext;
  invoiceId: string;
}

export async function listInvoiceDeliveryEvents(
  input: ListInvoiceDeliveryEventsInput,
  dependencies: {
    invoiceDeliveryEventReader: Pick<InvoiceDeliveryEventReader, 'hasInvoiceIdentity' | 'listDeliveryEvents'>;
  },
): Promise<InvoiceDeliveryEventSummary[]> {
  requirePermission(input.actorContext, 'sendInvoices');

  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  if (!await dependencies.invoiceDeliveryEventReader.hasInvoiceIdentity({ companyId, invoiceId })) {
    throw new ApprovedInvoiceNotFoundError();
  }

  return dependencies.invoiceDeliveryEventReader.listDeliveryEvents(
    companyId,
    invoiceId,
  );
}
