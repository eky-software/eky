import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { InvoiceVatRatesView } from './invoiceVatRatesView.js';
import {
  sortInvoiceVatRates,
  validateInvoiceVatRates,
  type InvoiceVatRateSetting,
  type StoredInvoiceVatRate,
} from '../domain/invoiceVatRates.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceVatRateRepository } from '../ports/invoiceVatRateRepository.js';

export interface UpdateInvoiceVatRatesInput {
  actorContext: ActorContext;
  now: string;
  vatRates: InvoiceVatRateSetting[];
}

export async function updateInvoiceVatRates(
  input: UpdateInvoiceVatRatesInput,
  invoiceVatRateRepository: InvoiceVatRateRepository,
): Promise<InvoiceVatRatesView> {
  requirePermission(input.actorContext, 'manageInvoiceSettings');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const now = requireIdentifier(input.now, 'Timestamp');
  const normalizedRates = input.vatRates.map(normalizeRate);

  validateInvoiceVatRates(normalizedRates);

  const currentRates = await invoiceVatRateRepository.listRates(companyId);
  const createdAtByRate = new Map(
    currentRates.map((vatRate) => [vatRate.rateBasisPoints, vatRate.createdAt]),
  );
  const storedRates: StoredInvoiceVatRate[] = normalizedRates.map((vatRate) => ({
    ...vatRate,
    companyId,
    createdAt: createdAtByRate.get(vatRate.rateBasisPoints) ?? now,
    updatedAt: now,
  }));
  const savedRates = await invoiceVatRateRepository.replaceRates(
    companyId,
    storedRates,
  );

  validateInvoiceVatRates(savedRates);

  return {
    vatRates: sortInvoiceVatRates(savedRates).map((vatRate) => ({
      rateBasisPoints: vatRate.rateBasisPoints,
      label: vatRate.label,
      isActive: vatRate.isActive,
      isDefault: vatRate.isDefault,
      sortOrder: vatRate.sortOrder,
    })),
    isPersisted: true,
  };
}

function normalizeRate(vatRate: InvoiceVatRateSetting): InvoiceVatRateSetting {
  return {
    rateBasisPoints: vatRate.rateBasisPoints,
    label: vatRate.label.trim(),
    isActive: vatRate.isActive,
    isDefault: vatRate.isDefault,
    sortOrder: vatRate.sortOrder,
  };
}
