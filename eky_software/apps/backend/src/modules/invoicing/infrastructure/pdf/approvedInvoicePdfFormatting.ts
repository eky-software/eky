import type { InvoiceLineDiscount } from '../../domain/invoiceCalculation.js';
import type { InvoiceKind } from '../../domain/invoiceKind.js';

export function formatPdfCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absoluteCents = Math.abs(cents);
  const euros = Math.floor(absoluteCents / 100);
  const remainder = absoluteCents % 100;

  return `${sign}${euros.toLocaleString('fi-FI')},${remainder
    .toString()
    .padStart(2, '0')} EUR`;
}

export function formatPdfPresentedCents(
  cents: number,
  invoiceKind: InvoiceKind,
): string {
  return formatPdfCents(invoiceKind === 'credit' ? -Math.abs(cents) : cents);
}

export function formatPdfDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

  if (!match) {
    return date;
  }

  const [, year, month, day] = match;

  return `${day}.${month}.${year}`;
}

export function formatPdfPercentBasisPoints(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const decimals = Math.abs(basisPoints % 100);

  return `${whole},${decimals.toString().padStart(2, '0')} %`;
}

export function formatPdfQuantity(quantityHundredths: number): string {
  const whole = Math.trunc(quantityHundredths / 100);
  const decimals = Math.abs(quantityHundredths % 100);

  return `${whole},${decimals.toString().padStart(2, '0')}`;
}

export function formatPdfDiscount(discount: InvoiceLineDiscount): string {
  if (discount.type === 'none') {
    return '';
  }

  if (discount.type === 'percentage') {
    return formatPdfPercentBasisPoints(discount.basisPoints);
  }

  return formatPdfCents(discount.amountCents);
}

export function formatPdfIban(iban: string): string {
  const normalizedIban = iban.replace(/\s+/g, '').toUpperCase();

  return normalizedIban.replace(/(.{4})/g, '$1 ').trim();
}
