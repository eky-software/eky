import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { InvoiceVatRatesView } from './invoiceVatRatesView.js';
import {
  defaultInvoiceVatRates,
  sortInvoiceVatRates,
  validateInvoiceVatRates,
  type InvoiceVatRateSetting,
} from '../domain/invoiceVatRates.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceVatRateRepository } from '../ports/invoiceVatRateRepository.js';

export interface GetInvoiceVatRatesInput {
  actorContext: ActorContext;
}

export async function getInvoiceVatRates(
  input: GetInvoiceVatRatesInput,
  invoiceVatRateRepository: InvoiceVatRateRepository,
): Promise<InvoiceVatRatesView> {
  requirePermission(input.actorContext, 'manageInvoiceSettings');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const storedRates = await invoiceVatRateRepository.listRates(companyId);

  if (storedRates.length === 0) {
    return {
      vatRates: defaultInvoiceVatRates.map((vatRate) => ({ ...vatRate })),
      isPersisted: false,
    };
  }

  validateInvoiceVatRates(storedRates);

  return {
    vatRates: sortInvoiceVatRates(storedRates).map(toViewRate),
    isPersisted: true,
  };
}

function toViewRate(
  vatRate: InvoiceVatRateSetting,
): InvoiceVatRateSetting {
  return {
    rateBasisPoints: vatRate.rateBasisPoints,
    label: vatRate.label,
    isActive: vatRate.isActive,
    isDefault: vatRate.isDefault,
    sortOrder: vatRate.sortOrder,
  };
}
