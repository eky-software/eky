import type {
  InvoiceVatRate,
  UpdateInvoiceVatRatesRequest,
} from './invoiceVatRatesTypes.js';

export function serializeInvoiceVatRatesInput(
  input: UpdateInvoiceVatRatesRequest,
): UpdateInvoiceVatRatesRequest {
  return {
    vatRates: input.vatRates.map(serializeInvoiceVatRate),
  };
}

function serializeInvoiceVatRate(vatRate: InvoiceVatRate): InvoiceVatRate {
  return {
    rateBasisPoints: vatRate.rateBasisPoints,
    label: vatRate.label,
    isActive: vatRate.isActive,
    isDefault: vatRate.isDefault,
    sortOrder: vatRate.sortOrder,
  };
}
