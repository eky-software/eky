import {
  parseEuroCents,
  parsePercentageBasisPoints,
  parseQuantityHundredths,
} from './invoiceDraftFormMapping.js';
import type { InvoiceRowForm } from './invoiceRowFormState.js';
import type { NewInvoiceFormState } from './newInvoiceFormState.js';
import { uiText } from '../../i18n/fi.js';

export interface InvoiceDraftLineFormErrors {
  description?: string;
  discountValue?: string;
  quantity?: string;
  unitPrice?: string;
}

export interface InvoiceDraftFormErrors {
  customerId?: string;
  dueDate?: string;
  invoiceDate?: string;
  lines: Record<string, InvoiceDraftLineFormErrors>;
  paymentTermDays?: string;
}

export interface InvoiceDraftFormValidationResult {
  errors: InvoiceDraftFormErrors;
  isValid: boolean;
}

export function validateInvoiceDraftForm(
  form: NewInvoiceFormState,
): InvoiceDraftFormValidationResult {
  const errors: InvoiceDraftFormErrors = { lines: {} };

  if (form.customerId.trim() === '') {
    errors.customerId = uiText.invoicing.validationCustomerRequired;
  }

  validateDates(form, errors);
  validatePaymentTerm(form.paymentTermDays, errors);

  for (const row of form.lines) {
    const lineErrors = validateInvoiceDraftLine(row);

    if (Object.keys(lineErrors).length > 0) {
      errors.lines[row.id] = lineErrors;
    }
  }

  return {
    errors,
    isValid:
      errors.customerId === undefined &&
      errors.invoiceDate === undefined &&
      errors.dueDate === undefined &&
      errors.paymentTermDays === undefined &&
      Object.keys(errors.lines).length === 0,
  };
}

function validateDates(
  form: NewInvoiceFormState,
  errors: InvoiceDraftFormErrors,
): void {
  const invoiceDate = form.invoiceDate.trim();
  const dueDate = form.dueDate.trim();

  if (invoiceDate === '') {
    errors.invoiceDate = uiText.invoicing.validationInvoiceDateRequired;
  } else if (!isValidIsoDate(invoiceDate)) {
    errors.invoiceDate = uiText.invoicing.validationDateInvalid;
  }

  if (dueDate === '') {
    errors.dueDate = uiText.invoicing.validationDueDateRequired;
  } else if (!isValidIsoDate(dueDate)) {
    errors.dueDate = uiText.invoicing.validationDateInvalid;
  }

  if (
    errors.invoiceDate === undefined &&
    errors.dueDate === undefined &&
    dueDate < invoiceDate
  ) {
    errors.dueDate = uiText.invoicing.validationDueDateBeforeInvoiceDate;
  }
}

function validatePaymentTerm(
  value: string,
  errors: InvoiceDraftFormErrors,
): void {
  const normalizedValue = value.trim();

  if (!/^\d+$/.test(normalizedValue)) {
    errors.paymentTermDays = uiText.invoicing.validationPaymentTerm;
    return;
  }

  const paymentTermDays = Number(normalizedValue);

  if (!Number.isSafeInteger(paymentTermDays)) {
    errors.paymentTermDays = uiText.invoicing.validationPaymentTerm;
  }
}

function validateInvoiceDraftLine(
  row: InvoiceRowForm,
): InvoiceDraftLineFormErrors {
  const errors: InvoiceDraftLineFormErrors = {};

  if (row.description.trim() === '') {
    errors.description = uiText.invoicing.validationDescriptionRequired;
  }

  const quantityHundredths = parseQuantityHundredths(row.quantity);

  if (quantityHundredths === null) {
    errors.quantity = uiText.invoicing.validationQuantityInvalid;
  } else if (quantityHundredths === 0) {
    errors.quantity = uiText.invoicing.validationQuantityPositive;
  }

  if (parseEuroCents(row.unitPrice) === null) {
    errors.unitPrice = uiText.invoicing.validationUnitPriceInvalid;
  }

  if (row.discountType !== 'none') {
    const discountValue =
      row.discountType === 'percentage'
        ? parsePercentageBasisPoints(row.discountValue)
        : parseEuroCents(row.discountValue);

    if (
      discountValue === null ||
      (row.discountType === 'percentage' && discountValue > 10_000)
    ) {
      errors.discountValue =
        row.discountType === 'percentage'
          ? uiText.invoicing.validationPercentageDiscountInvalid
          : uiText.invoicing.validationFixedDiscountInvalid;
    }
  }

  return errors;
}

function isValidIsoDate(value: string): boolean {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);

  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
