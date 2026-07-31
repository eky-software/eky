import { EkyApiError } from '../../http.js';
import type {
  ApprovedInvoiceNumberingMode,
  ApprovedInvoiceKind,
  ApprovedInvoicePriceInputMode,
  ApprovedInvoiceReferenceNumberType,
  ApprovedInvoiceUnit,
  ApprovedInvoiceViewStatus,
  InvoicePaymentReadModel,
} from './approvedInvoicesTypes.js';

export function parseInvoiceKind(value: unknown): ApprovedInvoiceKind {
  if (value === 'standard' || value === 'credit') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function readString(
  value: Record<string, unknown>,
  fieldName: string,
): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function readBoolean(
  value: Record<string, unknown>,
  fieldName: string,
): boolean {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function readNullableString(
  value: Record<string, unknown>,
  fieldName: string,
): string | null {
  const fieldValue = value[fieldName];

  if (fieldValue === null || typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function readOptionalString(
  value: Record<string, unknown>,
  fieldName: string,
): string | undefined {
  if (!(fieldName in value)) {
    return undefined;
  }

  return readString(value, fieldName);
}

export function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function readNullableSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number | null {
  const fieldValue = value[fieldName];

  if (fieldValue === null) {
    return null;
  }

  return readSafeInteger(value, fieldName);
}

export function parseInvoicePaymentReadModel(
  value: Record<string, unknown>,
  invoiceKind: ApprovedInvoiceKind,
): InvoicePaymentReadModel {
  const paymentState = value.paymentState;
  const paidOn = readNullableString(value, 'paidOn');
  const paidAmountCents = readNullableSafeInteger(value, 'paidAmountCents');
  const paymentSource = value.paymentSource;

  if (
    paymentState === 'paid' &&
    invoiceKind === 'standard' &&
    paidOn !== null &&
    paidOn.length > 0 &&
    paidAmountCents !== null &&
    paidAmountCents > 0 &&
    paymentSource === 'manual'
  ) {
    return { paidAmountCents, paidOn, paymentSource, paymentState };
  }

  if (
    ((paymentState === 'unpaid' && invoiceKind === 'standard') ||
      (paymentState === 'notApplicable' && invoiceKind === 'credit')) &&
    paidOn === null &&
    paidAmountCents === null &&
    paymentSource === null
  ) {
    return { paidAmountCents, paidOn, paymentSource, paymentState };
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function parseInvoiceStatus(value: unknown): ApprovedInvoiceViewStatus {
  if (value === 'approved' || value === 'sent' || value === 'cancelled') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function parseNumberingMode(
  value: unknown,
): ApprovedInvoiceNumberingMode {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function parseReferenceNumberType(
  value: unknown,
): ApprovedInvoiceReferenceNumberType {
  if (value === 'finnishDomestic' || value === 'none') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function parsePriceInputMode(
  value: unknown,
): ApprovedInvoicePriceInputMode {
  if (value === 'net' || value === 'gross') {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function parseInvoiceUnit(value: unknown): ApprovedInvoiceUnit {
  if (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 8 &&
    /^[\p{L}\p{N}.-]+$/u.test(value)
  ) {
    return value;
  }

  throw invalidApprovedInvoiceResponse(value);
}

export function invalidApprovedInvoiceResponse(
  responseBody: unknown,
): EkyApiError {
  return new EkyApiError('Invalid approved invoice response.', { responseBody });
}
