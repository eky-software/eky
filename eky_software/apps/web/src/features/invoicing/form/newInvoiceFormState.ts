import type { InvoicePriceInputMode } from '@eky/api-client';

import {
  createInitialInvoiceRows,
  type InvoiceRowForm,
} from './invoiceRowFormState.js';

export interface NewInvoiceFormState {
  customerId: string;
  dueDate: string;
  invoiceDate: string;
  lines: InvoiceRowForm[];
  note: string;
  orderNumber: string;
  paymentTermDays: string;
  priceInputMode: InvoicePriceInputMode;
  subject: string;
}

export type NewInvoiceBasicInfoField = Exclude<
  keyof NewInvoiceFormState,
  'lines'
>;

export function createInitialNewInvoiceForm(
  initialDate = new Date(),
): NewInvoiceFormState {
  return {
    customerId: '',
    dueDate: formatDateInput(addCalendarDays(initialDate, 14)),
    invoiceDate: formatDateInput(initialDate),
    lines: createInitialInvoiceRows(),
    note: '',
    orderNumber: '',
    paymentTermDays: '14',
    priceInputMode: 'net',
    subject: '',
  };
}

export function updateNewInvoiceFormField<
  FieldName extends keyof NewInvoiceFormState,
>(
  form: NewInvoiceFormState,
  fieldName: FieldName,
  value: NewInvoiceFormState[FieldName],
): NewInvoiceFormState {
  return {
    ...form,
    [fieldName]: value,
  };
}

function addCalendarDays(date: Date, days: number): Date {
  const result = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  result.setDate(result.getDate() + days);

  return result;
}

function formatDateInput(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}
