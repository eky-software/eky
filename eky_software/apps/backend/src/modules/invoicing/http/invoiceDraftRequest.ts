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

const maximumLineCount = 500;
const maximumIdentifierLength = 200;
const maximumShortTextLength = 500;
const maximumLongTextLength = 5000;

const invoiceDraftFields = new Set([
  'customerId',
  'invoiceDate',
  'dueDate',
  'paymentTermDays',
  'priceInputMode',
  'subject',
  'orderNumber',
  'note',
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

export class InvoiceDraftRequestValidationError extends Error {
  constructor() {
    super('Invalid invoice draft body.');
    this.name = 'InvoiceDraftRequestValidationError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  if (Object.keys(value).some((fieldName) => !allowedFields.has(fieldName))) {
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

function readDiscount(value: unknown): InvoiceLineDiscount {
  if (!isRecord(value) || typeof value.type !== 'string') {
    throw new InvoiceDraftRequestValidationError();
  }

  if (value.type === 'none') {
    assertAllowedFields(value, new Set(['type']));
    return { type: 'none' };
  }

  if (value.type === 'percentage') {
    assertAllowedFields(value, new Set(['type', 'basisPoints']));
    return {
      type: 'percentage',
      basisPoints: readSafeInteger(value, 'basisPoints'),
    };
  }

  if (value.type === 'fixed') {
    assertAllowedFields(value, new Set(['type', 'amountCents']));
    return {
      type: 'fixed',
      amountCents: readSafeInteger(value, 'amountCents'),
    };
  }

  throw new InvoiceDraftRequestValidationError();
}

function readLine(value: unknown): SaveInvoiceDraftLineInput {
  if (!isRecord(value)) {
    throw new InvoiceDraftRequestValidationError();
  }

  assertAllowedFields(value, invoiceDraftLineFields);

  const line: SaveInvoiceDraftLineInput = {
    description: readString(
      value,
      'description',
      maximumLongTextLength,
    ),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
    unit: readString(value, 'unit', maximumShortTextLength),
    unitPriceCents: readSafeInteger(value, 'unitPriceCents'),
    vatRateBasisPoints: readSafeInteger(value, 'vatRateBasisPoints'),
    discount: readDiscount(value.discount),
  };
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

  const input: InvoiceDraftContentInput = {
    customerId: readString(
      body,
      'customerId',
      maximumIdentifierLength,
    ),
    invoiceDate: readString(body, 'invoiceDate', 10),
    priceInputMode: readPriceInputMode(body),
    lines: body.lines.map(readLine),
  };
  const dueDate = readOptionalString(body, 'dueDate', 10);
  const paymentTermDays = readOptionalSafeInteger(body, 'paymentTermDays');
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

  if (dueDate !== undefined) {
    input.dueDate = dueDate;
  }

  if (paymentTermDays !== undefined) {
    input.paymentTermDays = paymentTermDays;
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
