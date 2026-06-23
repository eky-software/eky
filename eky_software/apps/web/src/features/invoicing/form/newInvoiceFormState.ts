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
  if (fieldName === 'invoiceDate' && typeof value === 'string') {
    return {
      ...form,
      dueDate: calculateDueDateInput(value, form.paymentTermDays) ?? form.dueDate,
      invoiceDate: value,
    };
  }

  if (fieldName === 'paymentTermDays' && typeof value === 'string') {
    return {
      ...form,
      dueDate: calculateDueDateInput(form.invoiceDate, value) ?? form.dueDate,
      paymentTermDays: value,
    };
  }

  return {
    ...form,
    [fieldName]: value,
  };
}

export function calculateDueDateInput(
  invoiceDateInput: string,
  paymentTermDaysInput: string,
): string | null {
  const invoiceDate = parseDateInput(invoiceDateInput);
  const paymentTermDays = parsePaymentTermDays(paymentTermDaysInput);

  if (invoiceDate === null || paymentTermDays === null) {
    return null;
  }

  return formatDateInput(addCalendarDays(invoiceDate, paymentTermDays));
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

function parseDateInput(value: string): Date | null {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match === null) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);

  return date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
    ? date
    : null;
}

function parsePaymentTermDays(value: string): number | null {
  const normalizedValue = value.trim();

  if (!/^\d+$/.test(normalizedValue)) {
    return null;
  }

  const paymentTermDays = Number(normalizedValue);

  return Number.isSafeInteger(paymentTermDays) ? paymentTermDays : null;
}
