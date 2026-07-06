import type {
  ApprovedInvoiceLineDiscount,
  ApprovedInvoiceUnit,
} from '@eky/api-client';

import { uiText } from '../../../i18n/fi.js';
import {
  formatInvoiceDraftCurrency,
  formatInvoiceDraftDate,
} from '../drafts/invoiceDraftFormatting.js';

export function formatApprovedInvoiceCurrency(cents: number): string {
  return formatInvoiceDraftCurrency(cents);
}

export function formatApprovedInvoiceDate(date: string): string {
  return formatInvoiceDraftDate(date);
}

export function formatApprovedInvoiceQuantity(quantityHundredths: number): string {
  return (quantityHundredths / 100).toLocaleString('fi-FI', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  });
}

export function formatApprovedInvoicePercent(basisPoints: number): string {
  return `${(basisPoints / 100).toLocaleString('fi-FI', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  })} %`;
}

export function formatApprovedInvoiceUnit(unit: ApprovedInvoiceUnit): string {
  switch (unit) {
    case 'h':
      return uiText.invoicing.unitHour;
    case 'kpl':
      return uiText.invoicing.unitPiece;
    case 'pv':
      return uiText.invoicing.unitDay;
    case 'km':
      return uiText.invoicing.unitKilometre;
    case 'erä':
      return uiText.invoicing.unitBatch;
  }
}

export function formatApprovedInvoiceDiscount(
  discount: ApprovedInvoiceLineDiscount,
): string | null {
  switch (discount.type) {
    case 'none':
      return null;
    case 'percentage':
      return formatApprovedInvoicePercent(discount.basisPoints);
    case 'fixed':
      return formatApprovedInvoiceCurrency(discount.amountCents);
  }
}

export function hasApprovedInvoiceValue(value: string): boolean {
  return value.trim().length > 0;
}

export function formatApprovedInvoiceIban(iban: string): string {
  const normalizedIban = iban.replace(/\s+/g, '').toUpperCase();

  return normalizedIban.replace(/(.{4})/g, '$1 ').trim();
}
