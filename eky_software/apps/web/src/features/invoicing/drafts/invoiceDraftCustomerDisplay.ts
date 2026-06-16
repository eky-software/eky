import type { Customer, InvoiceDraftSummary } from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';

export function getInvoiceDraftCustomerDisplayName(
  draft: InvoiceDraftSummary,
  customers: readonly Customer[],
): string {
  const customer = customers.find(
    (candidate) => candidate.id === draft.customerId,
  );

  if (customer === undefined) {
    return uiText.invoicing.customerNotFound;
  }

  return `${customer.customerNumber} – ${customer.name}`;
}
