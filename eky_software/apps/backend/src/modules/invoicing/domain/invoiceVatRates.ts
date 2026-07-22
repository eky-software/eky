import { InvoiceVatRatesError } from './invoiceVatRatesError.js';

export interface InvoiceVatRateSetting {
  rateBasisPoints: number;
  label: string;
  isActive: boolean;
  isDefault: boolean;
  sortOrder: number;
}

export interface StoredInvoiceVatRate extends InvoiceVatRateSetting {
  companyId: string;
  createdAt: string;
  updatedAt: string;
}

export const defaultInvoiceVatRates: readonly InvoiceVatRateSetting[] =
  Object.freeze([
    createDefaultRate(2550, '25,50 %', true, 0),
    createDefaultRate(1350, '13,50 %', false, 1),
    createDefaultRate(1000, '10,00 %', false, 2),
    createDefaultRate(0, '0,00 %', false, 3),
  ]);

export function validateInvoiceVatRates(
  vatRates: readonly InvoiceVatRateSetting[],
): void {
  if (vatRates.length < 1 || vatRates.length > 20) {
    throw new InvoiceVatRatesError(
      'Invoice VAT rates must contain between 1 and 20 items.',
    );
  }

  const seenRates = new Set<number>();
  let defaultCount = 0;

  for (const vatRate of vatRates) {
    validateSafeInteger(vatRate.rateBasisPoints, 0, 10000, 'VAT rate');
    validateSafeInteger(vatRate.sortOrder, 0, 1000, 'VAT rate sort order');

    if (seenRates.has(vatRate.rateBasisPoints)) {
      throw new InvoiceVatRatesError('Invoice VAT rates must be unique.');
    }
    seenRates.add(vatRate.rateBasisPoints);

    if (
      vatRate.label !== vatRate.label.trim() ||
      vatRate.label.length < 1 ||
      vatRate.label.length > 50 ||
      /[\r\n\0]/.test(vatRate.label)
    ) {
      throw new InvoiceVatRatesError('Invoice VAT rate label is invalid.');
    }

    if (vatRate.isDefault) {
      defaultCount += 1;

      if (!vatRate.isActive) {
        throw new InvoiceVatRatesError(
          'Default invoice VAT rate must be active.',
        );
      }
    }
  }

  if (defaultCount !== 1) {
    throw new InvoiceVatRatesError(
      'Invoice VAT rates must have exactly one default.',
    );
  }
}

export function sortInvoiceVatRates<T extends InvoiceVatRateSetting>(
  vatRates: readonly T[],
): T[] {
  return [...vatRates].sort(
    (left, right) =>
      left.sortOrder - right.sortOrder ||
      right.rateBasisPoints - left.rateBasisPoints,
  );
}

function createDefaultRate(
  rateBasisPoints: number,
  label: string,
  isDefault: boolean,
  sortOrder: number,
): InvoiceVatRateSetting {
  return Object.freeze({
    rateBasisPoints,
    label,
    isActive: true,
    isDefault,
    sortOrder,
  });
}

function validateSafeInteger(
  value: number,
  minimum: number,
  maximum: number,
  fieldName: string,
): void {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new InvoiceVatRatesError(`${fieldName} is invalid.`);
  }
}
