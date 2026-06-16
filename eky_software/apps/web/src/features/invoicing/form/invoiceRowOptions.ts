import type { InvoiceUnit } from '@eky/api-client';

import type { InvoiceRowDiscountType } from './invoiceRowFormState.js';
import { uiText } from '../../../i18n/fi.js';

interface InvoiceRowOption<Value> {
  value: Value;
  label: string;
}

export const invoiceUnitOptions: readonly InvoiceRowOption<InvoiceUnit>[] = [
  { value: 'h', label: uiText.invoicing.unitHour },
  { value: 'kpl', label: uiText.invoicing.unitPiece },
  { value: 'pv', label: uiText.invoicing.unitDay },
  { value: 'km', label: uiText.invoicing.unitKilometre },
  { value: 'erä', label: uiText.invoicing.unitBatch },
];

export const invoiceVatRateOptions: readonly InvoiceRowOption<number>[] = [
  { value: 2550, label: '25,5 %' },
  { value: 1350, label: '13,5 %' },
  { value: 1000, label: '10 %' },
  { value: 0, label: '0 %' },
];

export const invoiceDiscountTypeOptions: readonly InvoiceRowOption<InvoiceRowDiscountType>[] =
  [
    { value: 'none', label: uiText.invoicing.discountNone },
    { value: 'percentage', label: uiText.invoicing.discountPercentage },
    { value: 'fixed', label: uiText.invoicing.discountFixed },
  ];
