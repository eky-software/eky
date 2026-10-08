import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type {
  InvoiceDraftDeliveryHistory,
  InvoiceDraftDeliveryHistoryReader,
} from '../ports/invoiceDraftDeliveryHistoryReader.js';
import { InvoiceDraftNotFoundError } from './invoiceDraftNotFoundError.js';

export interface GetInvoiceDraftDeliveryHistoryInput {
  actorContext: ActorContext;
  invoiceDraftId: string;
}

export async function getInvoiceDraftDeliveryHistory(
  input: GetInvoiceDraftDeliveryHistoryInput,
  dependencies: { invoiceDraftDeliveryHistoryReader: InvoiceDraftDeliveryHistoryReader },
): Promise<InvoiceDraftDeliveryHistory> {
  requirePermission(input.actorContext, 'sendInvoices');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceDraftId = requireIdentifier(input.invoiceDraftId, 'Invoice draft id');
  const history = await dependencies.invoiceDraftDeliveryHistoryReader.findDeliveryHistory({
    companyId,
    invoiceDraftId,
  });
  if (history === undefined) throw new InvoiceDraftNotFoundError();
  return history;
}
