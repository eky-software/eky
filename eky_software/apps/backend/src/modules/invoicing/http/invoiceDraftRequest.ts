import {
  hasOnlyAllowedFields,
  isRecord,
} from '../../../http/requestBody.js';
import type {
  SaveInvoiceDraftInput,
  SaveInvoiceDraftLineInput,
} from '../application/saveInvoiceDraft.js';
import type { UpdateInvoiceDraftInput } from '../application/updateInvoiceDraft.js';
import type { InvoiceDraftContentInput } from '../application/prepareInvoiceDraftContent.js';
import type {
  InvoiceLineDiscount,
  PriceInputMode,
} from '../domain/invoiceCalculation.js';
import type { InvoicePerformancePeriod } from '../domain/invoicePerformancePeriod.js';
import type { InvoiceTaxTreatment } from '../domain/invoiceTaxTreatment.js';
import { maximumInvoiceUnitLength } from '../domain/invoiceDraftRules.js';

const maximumLineCount = 500;
const maximumIdentifierLength = 200;
const maximumShortTextLength = 500;
const maximumLongTextLength = 5000;

const invoiceDraftFields = new Set([
  'customerId',
  'billingRecipientCustomerId',
  'invoiceDate',
  'dueDate',
  'paymentTermDays',
  'reminderPeriodDays',
  'latePaymentInterestBasisPoints',
  'priceInputMode',
  'taxTreatment',
  'performancePeriod',
  'subject',
  'orderNumber',
  'note',
  'deliveryAddressText',
  'lines',
]);

const invoiceDraftLineFields = new Set([
  'code',
  'description',
  'quantityHundredths',
  'unit',
  'unitPriceCents',
  'vatRateBasisPoints',
  'discount',
]);
const invoiceDatePerformancePeriodFields = new Set(['type']);
const singleDatePerformancePeriodFields = new Set(['type', 'date']);
const dateRangePerformancePeriodFields = new Set([
  'type',
  'startDate',
  'endDate',
]);
const noDiscountFields = new Set(['type']);
const percentageDiscountFields = new Set(['type', 'basisPoints']);
const fixedDiscountFields = new Set(['type', 'amountCents']);

export class InvoiceDraftRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice draft body.');
    this.name = 'InvoiceDraftRequestValidationError';
  }
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  if (!hasOnlyAllowedFields(value, allowedFields)) {
    throw new InvoiceDraftRequestValidationError();
  }
}

function readString(
  value: Record<string, unknown>,
  fieldName: string,
  maximumLength: number,
): string {
  const fieldValue = value[fieldName];

  if (
    typeof fieldValue !== 'string' ||
    fieldValue.length > maximumLength
  ) {
    throw new InvoiceDraftRequestValidationError();
  }

  return fieldValue;
}

function readOptionalString(
  value: Record<string, unknown>,
  fieldName: string,
  maximumLength: number,
): string | undefined {
  if (!(fieldName in value)) {
    return undefined;
  }

  return readString(value, fieldName, maximumLength);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue !== 'number' || !Number.isSafeInteger(fieldValue)) {
    throw new InvoiceDraftRequestValidationError();
  }

  return fieldValue;
}

function readOptionalSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number | undefined {
  if (!(fieldName in value)) {
    return undefined;
  }

  return readSafeInteger(value, fieldName);
}

function readPriceInputMode(
  value: Record<string, unknown>,
): PriceInputMode {
  const priceInputMode = value.priceInputMode;

  if (priceInputMode !== 'net' && priceInputMode !== 'gross') {
    throw new InvoiceDraftRequestValidationError();
  }

  return priceInputMode;
}

function readTaxTreatment(
  value: Record<string, unknown>,
): InvoiceTaxTreatment | undefined {
  if (!('taxTreatment' in value)) {
    return undefined;
  }

  if (
    value.taxTreatment !== 'normalVat' &&
    value.taxTreatment !== 'reverseChargeConstruction'
  ) {
    throw new InvoiceDraftRequestValidationError();
  }

  return value.taxTreatment;
}

function readPerformancePeriod(
  value: Record<string, unknown>,
): InvoicePerformancePeriod | undefined {
  if (!('performancePeriod' in value)) {
    return undefined;
  }

  const period = value.performancePeriod;

  if (!isRecord(period) || typeof period.type !== 'string') {
    throw new InvoiceDraftRequestValidationError();
  }

  if (period.type === 'invoiceDate') {
    assertAllowedFields(period, invoiceDatePerformancePeriodFields);
    return { type: period.type };
  }

  if (period.type === 'singleDate') {
    assertAllowedFields(period, singleDatePerformancePeriodFields);
    return {
      type: period.type,
      date: readString(period, 'date', 10),
    };
  }

  if (period.type === 'dateRange') {
    assertAllowedFields(period, dateRangePerformancePeriodFields);
    return {
      type: period.type,
      startDate: readString(period, 'startDate', 10),
      endDate: readString(period, 'endDate', 10),
    };
  }

  throw new InvoiceDraftRequestValidationError();
}

function readDiscount(value: unknown): InvoiceLineDiscount {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new InvoiceDraftRequestValidationError();
  }

  if (value.type === 'none') {
    assertAllowedFields(value, noDiscountFields);
    return { type: 'none' };
  }

  if (value.type === 'percentage') {
    assertAllowedFields(value, percentageDiscountFields);
    return {
      type: 'percentage',
      basisPoints: readSafeInteger(value, 'basisPoints'),
    };
  }

  if (value.type === 'fixed') {
    assertAllowedFields(value, fixedDiscountFields);
    return {
      type: 'fixed',
      amountCents: readSafeInteger(value, 'amountCents'),
    };
  }

  throw new InvoiceDraftRequestValidationError();
}

function readLine(
  value: unknown,
  taxTreatment: InvoiceTaxTreatment,
): SaveInvoiceDraftLineInput {
  if (!isRecord(value)) {
    throw new InvoiceDraftRequestValidationError();
  }

  assertAllowedFields(value, invoiceDraftLineFields);

  const vatRateBasisPoints = value.vatRateBasisPoints;
  const line: SaveInvoiceDraftLineInput = {
    description: readString(
      value,
      'description',
      maximumLongTextLength,
    ),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
    unit: readString(value, 'unit', maximumInvoiceUnitLength),
    unitPriceCents: readSafeInteger(value, 'unitPriceCents'),
    discount: readDiscount(value.discount),
  };

  if (taxTreatment === 'normalVat') {
    line.vatRateBasisPoints = readSafeInteger(
      value,
      'vatRateBasisPoints',
    );
  } else if (
    'vatRateBasisPoints' in value &&
    vatRateBasisPoints !== null
  ) {
    throw new InvoiceDraftRequestValidationError();
  }
  const code = readOptionalString(value, 'code', maximumShortTextLength);

  if (code !== undefined) {
    line.code = code;
  }

  return line;
}

function parseInvoiceDraftContentRequest(
  body: unknown,
): InvoiceDraftContentInput {
  if (!isRecord(body)) {
    throw new InvoiceDraftRequestValidationError();
  }

  assertAllowedFields(body, invoiceDraftFields);

  if (!Array.isArray(body.lines) || body.lines.length > maximumLineCount) {
    throw new InvoiceDraftRequestValidationError();
  }
  const taxTreatment = readTaxTreatment(body) ?? 'normalVat';

  const input: InvoiceDraftContentInput = {
    customerId: readString(
      body,
      'customerId',
      maximumIdentifierLength,
    ),
    invoiceDate: readString(body, 'invoiceDate', 10),
    priceInputMode: readPriceInputMode(body),
    taxTreatment,
    lines: body.lines.map((line) => readLine(line, taxTreatment)),
  };
  const performancePeriod = readPerformancePeriod(body);
  const billingRecipientCustomerId = readOptionalString(
    body,
    'billingRecipientCustomerId',
    maximumIdentifierLength,
  );
  const dueDate = readOptionalString(body, 'dueDate', 10);
  const paymentTermDays = readOptionalSafeInteger(body, 'paymentTermDays');
  const reminderPeriodDays = readOptionalSafeInteger(
    body,
    'reminderPeriodDays',
  );
  const latePaymentInterestBasisPoints = readOptionalSafeInteger(
    body,
    'latePaymentInterestBasisPoints',
  );
  const subject = readOptionalString(
    body,
    'subject',
    maximumShortTextLength,
  );
  const orderNumber = readOptionalString(
    body,
    'orderNumber',
    maximumShortTextLength,
  );
  const note = readOptionalString(body, 'note', maximumLongTextLength);
  const deliveryAddressText = readOptionalString(
    body,
    'deliveryAddressText',
    maximumShortTextLength,
  );

  if (billingRecipientCustomerId !== undefined) {
    input.billingRecipientCustomerId = billingRecipientCustomerId;
  }

  if (dueDate !== undefined) {
    input.dueDate = dueDate;
  }

  if (paymentTermDays !== undefined) {
    input.paymentTermDays = paymentTermDays;
  }

  if (reminderPeriodDays !== undefined) {
    input.reminderPeriodDays = reminderPeriodDays;
  }

  if (latePaymentInterestBasisPoints !== undefined) {
    input.latePaymentInterestBasisPoints =
      latePaymentInterestBasisPoints;
  }

  if (subject !== undefined) {
    input.subject = subject;
  }

  if (orderNumber !== undefined) {
    input.orderNumber = orderNumber;
  }

  if (note !== undefined) {
    input.note = note;
  }

  if (deliveryAddressText !== undefined) {
    input.deliveryAddressText = deliveryAddressText;
  }

  if (performancePeriod !== undefined) {
    input.performancePeriod = performancePeriod;
  }

  return input;
}

export function parseSaveInvoiceDraftRequest(
  body: unknown,
  companyId: string,
): SaveInvoiceDraftInput {
  return {
    ...parseInvoiceDraftContentRequest(body),
    companyId,
  };
}

export function parseUpdateInvoiceDraftRequest(
  body: unknown,
  companyId: string,
  invoiceDraftId: string,
): UpdateInvoiceDraftInput {
  return {
    ...parseInvoiceDraftContentRequest(body),
    companyId,
    invoiceDraftId,
  };
}
