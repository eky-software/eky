import type { InvoiceUnit, InvoiceVatRate } from '@eky/api-client';

import type { InvoiceRowDiscountType } from './invoiceRowFormState.js';
import { uiText } from '../../../i18n/fi.js';

export interface InvoiceRowOption<Value> {
  value: Value;
  label: string;
}

export const invoiceUnitOptions: readonly InvoiceRowOption<InvoiceUnit>[] = [
  { value: 'h', label: uiText.invoicing.unitHour },
  { value: 'kpl', label: uiText.invoicing.unitPiece },
  { value: 'pv', label: uiText.invoicing.unitDay },
  { value: 'km', label: uiText.invoicing.unitKilometre },
  { value: 'erä', label: uiText.invoicing.unitBatch },
  { value: 'pak', label: uiText.invoicing.unitPackage },
];

export const customInvoiceUnitSelectValue = '__custom_invoice_unit__';

export function isKnownInvoiceUnit(value: string): boolean {
  return invoiceUnitOptions.some((option) => option.value === value);
}

export const invoiceVatRateOptions: readonly InvoiceRowOption<number>[] = [
  { value: 2550, label: '25,5 %' },
  { value: 1350, label: '13,5 %' },
  { value: 1000, label: '10 %' },
];

export function createInvoiceVatRateOptions(
  configuredRates: readonly InvoiceVatRate[] | null,
  currentRateBasisPoints: number | null,
): InvoiceRowOption<number>[] {
  const activeRates = configuredRates === null
    ? [...invoiceVatRateOptions]
    : configuredRates
        .filter((vatRate) => vatRate.isActive && vatRate.rateBasisPoints > 0)
        .sort((left, right) => left.sortOrder - right.sortOrder)
        .map((vatRate) => ({
          value: vatRate.rateBasisPoints,
          label: vatRate.label,
        }));

  if (
    currentRateBasisPoints !== null &&
    !activeRates.some((option) => option.value === currentRateBasisPoints)
  ) {
    activeRates.push({
      value: currentRateBasisPoints,
      label: `${formatVatRate(currentRateBasisPoints)} (laskulla käytössä)`,
    });
  }

  return activeRates;
}

export function getDefaultInvoiceVatRateBasisPoints(
  configuredRates: readonly InvoiceVatRate[] | null,
): number {
  return configuredRates?.find(
    (vatRate) => vatRate.isActive && vatRate.isDefault,
  )?.rateBasisPoints ?? 2550;
}

function formatVatRate(rateBasisPoints: number): string {
  const whole = Math.trunc(rateBasisPoints / 100);
  const decimal = String(rateBasisPoints % 100).padStart(2, '0');
  return `${whole},${decimal} %`;
}

export const invoiceDiscountTypeOptions: readonly InvoiceRowOption<InvoiceRowDiscountType>[] =
  [
    { value: 'none', label: uiText.invoicing.discountNone },
    { value: 'percentage', label: uiText.invoicing.discountPercentage },
    { value: 'fixed', label: uiText.invoicing.discountFixed },
  ];
