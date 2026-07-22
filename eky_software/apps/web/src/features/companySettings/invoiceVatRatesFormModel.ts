import type {
  InvoiceVatRatesView,
  UpdateInvoiceVatRatesRequest,
} from '@eky/api-client';

import {
  basisPointsToPercentInput,
  percentInputToBasisPoints,
} from './invoicePaymentSettingsFormModel.js';

export interface InvoiceVatRateFormRow {
  id: string;
  ratePercent: string;
  label: string;
  isActive: boolean;
  isDefault: boolean;
}

export interface InvoiceVatRatesValidationErrors {
  form?: string;
  rows: Record<string, { ratePercent?: string; label?: string }>;
}

export function toInvoiceVatRatesForm(
  settings: InvoiceVatRatesView,
): InvoiceVatRateFormRow[] {
  return settings.vatRates.map((vatRate, index) => ({
    id: `stored-vat-rate-${index}`,
    ratePercent: basisPointsToPercentInput(vatRate.rateBasisPoints),
    label: vatRate.label,
    isActive: vatRate.isActive,
    isDefault: vatRate.isDefault,
  }));
}

export function createEmptyInvoiceVatRateFormRow(
  id: string,
): InvoiceVatRateFormRow {
  return {
    id,
    ratePercent: '',
    label: '',
    isActive: true,
    isDefault: false,
  };
}

export function validateInvoiceVatRatesForm(
  rows: readonly InvoiceVatRateFormRow[],
  messages: {
    collectionInvalid: string;
    defaultInvalid: string;
    duplicateRate: string;
    labelInvalid: string;
    rateInvalid: string;
  },
): InvoiceVatRatesValidationErrors {
  const errors: InvoiceVatRatesValidationErrors = { rows: {} };
  const seenRates = new Set<number>();

  if (rows.length < 1 || rows.length > 20) {
    errors.form = messages.collectionInvalid;
  }

  for (const row of rows) {
    const rowErrors: { ratePercent?: string; label?: string } = {};

    try {
      const rateBasisPoints = percentInputToBasisPoints(row.ratePercent);
      if (rateBasisPoints > 10000) {
        throw new Error('Invalid VAT rate.');
      }
      if (seenRates.has(rateBasisPoints)) {
        rowErrors.ratePercent = messages.duplicateRate;
      }
      seenRates.add(rateBasisPoints);
    } catch {
      rowErrors.ratePercent = messages.rateInvalid;
    }

    const label = row.label.trim();
    if (label.length < 1 || label.length > 50 || /[\r\n\0]/.test(label)) {
      rowErrors.label = messages.labelInvalid;
    }

    if (Object.keys(rowErrors).length > 0) {
      errors.rows[row.id] = rowErrors;
    }
  }

  const defaultRows = rows.filter((row) => row.isDefault && row.isActive);
  if (defaultRows.length !== 1 || rows.some((row) => row.isDefault && !row.isActive)) {
    errors.form = messages.defaultInvalid;
  }

  return errors;
}

export function hasInvoiceVatRatesValidationErrors(
  errors: InvoiceVatRatesValidationErrors,
): boolean {
  return errors.form !== undefined || Object.keys(errors.rows).length > 0;
}

export function toUpdateInvoiceVatRatesRequest(
  rows: readonly InvoiceVatRateFormRow[],
): UpdateInvoiceVatRatesRequest {
  return {
    vatRates: rows.map((row, index) => ({
      rateBasisPoints: percentInputToBasisPoints(row.ratePercent),
      label: row.label.trim(),
      isActive: row.isActive,
      isDefault: row.isDefault,
      sortOrder: index,
    })),
  };
}
