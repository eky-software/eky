import type {
  InvoicePriceInputMode,
  InvoiceTaxTreatment,
} from '@eky/api-client';

import {
  createInitialInvoiceRows,
  type InvoiceRowForm,
} from './invoiceRowFormState.js';

export interface NewInvoiceFormState {
  billingRecipientCustomerId: string;
  customerId: string;
  deliveryAddressText: string;
  dueDate: string;
  invoiceDate: string;
  latePaymentInterestPercent: string;
  lines: InvoiceRowForm[];
  note: string;
  orderNumber: string;
  paymentTermDays: string;
  performanceDate: string;
  performancePeriodEnd: string;
  performancePeriodStart: string;
  performancePeriodType: 'dateRange' | 'invoiceDate' | 'singleDate';
  priceInputMode: InvoicePriceInputMode;
  reminderPeriodDays: string;
  subject: string;
  taxTreatment: InvoiceTaxTreatment;
}

export type NewInvoiceBasicInfoField = Exclude<
  keyof NewInvoiceFormState,
  'lines'
>;

export function createInitialNewInvoiceForm(
  initialDate = new Date(),
): NewInvoiceFormState {
  return {
    billingRecipientCustomerId: '',
    customerId: '',
    deliveryAddressText: '',
    dueDate: formatDateInput(addCalendarDays(initialDate, 14)),
    invoiceDate: formatDateInput(initialDate),
    latePaymentInterestPercent: '',
    lines: createInitialInvoiceRows(),
    note: '',
    orderNumber: '',
    paymentTermDays: '14',
    performanceDate: '',
    performancePeriodEnd: '',
    performancePeriodStart: '',
    performancePeriodType: 'invoiceDate',
    priceInputMode: 'net',
    reminderPeriodDays: '',
    subject: '',
    taxTreatment: 'normalVat',
  };
}

export function applyInvoiceTaxTreatment(
  form: NewInvoiceFormState,
  taxTreatment: InvoiceTaxTreatment,
  defaultVatRateBasisPoints: number,
): NewInvoiceFormState {
  return {
    ...form,
    priceInputMode:
      taxTreatment === 'reverseChargeConstruction'
        ? 'net'
        : form.priceInputMode,
    taxTreatment,
    lines: form.lines.map((line) => ({
      ...line,
      vatRateBasisPoints:
        taxTreatment === 'reverseChargeConstruction'
          ? null
          : line.vatRateBasisPoints ?? defaultVatRateBasisPoints,
    })),
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

  if (fieldName === 'performancePeriodType') {
    const performancePeriodType =
      value as NewInvoiceFormState['performancePeriodType'];

    return {
      ...form,
      performanceDate:
        performancePeriodType === 'singleDate' ? form.performanceDate : '',
      performancePeriodEnd:
        performancePeriodType === 'dateRange' ? form.performancePeriodEnd : '',
      performancePeriodStart:
        performancePeriodType === 'dateRange'
          ? form.performancePeriodStart
          : '',
      performancePeriodType,
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
