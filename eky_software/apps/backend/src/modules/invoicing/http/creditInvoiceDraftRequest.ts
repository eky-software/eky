import type { ActorContext } from '@eky/auth';

import type { CreditInvoiceDraftLineInput } from '../application/creditInvoiceDraftModel.js';
import type { UpdateCreditInvoiceDraftInput } from '../application/updateCreditInvoiceDraft.js';

const maximumLineCount = 500;
const maximumIdentifierLength = 200;
const maximumShortTextLength = 500;
const maximumLongTextLength = 5_000;
const maximumIbanLength = 34;
const maximumUnitLength = 8;
const creditDraftFields = new Set([
  'subject',
  'note',
  'refundIban',
  'lines',
]);
const sourceCreditDraftLineFields = new Set([
  'lineType',
  'sourceInvoiceLineId',
  'description',
  'quantityHundredths',
]);
const manualCreditDraftLineFields = new Set([
  'lineType',
  'description',
  'quantityHundredths',
  'unit',
  'unitPriceCents',
  'vatRateBasisPoints',
]);

export class CreditInvoiceDraftRequestValidationError extends Error {
  constructor() {
    super('Invalid credit invoice draft request.');
    this.name = 'CreditInvoiceDraftRequestValidationError';
  }
}

export function parseEmptyCreditInvoiceDraftRequest(bodyText: string): void {
  const normalized = bodyText.trim();

  if (normalized === '') {
    return;
  }

  let body: unknown;

  try {
    body = JSON.parse(normalized);
  } catch {
    throw new CreditInvoiceDraftRequestValidationError();
  }

  if (!isRecord(body) || Object.keys(body).length !== 0) {
    throw new CreditInvoiceDraftRequestValidationError();
  }
}

export function parseUpdateCreditInvoiceDraftRequest(
  body: unknown,
  options: {
    actorContext: ActorContext;
    invoiceDraftId: string;
  },
): UpdateCreditInvoiceDraftInput {
  if (!isRecord(body)) {
    throw new CreditInvoiceDraftRequestValidationError();
  }

  assertAllowedFields(body, creditDraftFields);

  if (!Array.isArray(body.lines) || body.lines.length > maximumLineCount) {
    throw new CreditInvoiceDraftRequestValidationError();
  }

  return {
    actorContext: options.actorContext,
    invoiceDraftId: options.invoiceDraftId,
    subject: readString(body, 'subject', maximumShortTextLength),
    note: readString(body, 'note', maximumLongTextLength),
    refundIban: readString(body, 'refundIban', maximumIbanLength),
    lines: body.lines.map(readCreditDraftLine),
  };
}

function readCreditDraftLine(value: unknown): CreditInvoiceDraftLineInput {
  if (!isRecord(value)) {
    throw new CreditInvoiceDraftRequestValidationError();
  }

  const lineType = readString(value, 'lineType', 20);
  if (lineType === 'source') {
    assertAllowedFields(value, sourceCreditDraftLineFields);

    return {
      lineType,
      sourceInvoiceLineId: readString(
        value,
        'sourceInvoiceLineId',
        maximumIdentifierLength,
      ),
      description: readString(value, 'description', maximumLongTextLength),
      quantityHundredths: readPositiveSafeInteger(
        value,
        'quantityHundredths',
      ),
    };
  }

  if (lineType === 'manual') {
    assertAllowedFields(value, manualCreditDraftLineFields);

    return {
      lineType,
      description: readString(value, 'description', maximumLongTextLength),
      quantityHundredths: readPositiveSafeInteger(
        value,
        'quantityHundredths',
      ),
      unit: readString(value, 'unit', maximumUnitLength),
      unitPriceCents: readNonnegativeSafeInteger(value, 'unitPriceCents'),
      vatRateBasisPoints: readNullableNonnegativeSafeInteger(
        value,
        'vatRateBasisPoints',
      ),
    };
  }

  throw new CreditInvoiceDraftRequestValidationError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertAllowedFields(
  value: Record<string, unknown>,
  allowedFields: ReadonlySet<string>,
): void {
  if (Object.keys(value).some((fieldName) => !allowedFields.has(fieldName))) {
    throw new CreditInvoiceDraftRequestValidationError();
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
    throw new CreditInvoiceDraftRequestValidationError();
  }

  return fieldValue;
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue !== 'number' || !Number.isSafeInteger(fieldValue)) {
    throw new CreditInvoiceDraftRequestValidationError();
  }

  return fieldValue;
}

function readPositiveSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = readSafeInteger(value, fieldName);
  if (fieldValue <= 0) {
    throw new CreditInvoiceDraftRequestValidationError();
  }
  return fieldValue;
}

function readNonnegativeSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = readSafeInteger(value, fieldName);
  if (fieldValue < 0) {
    throw new CreditInvoiceDraftRequestValidationError();
  }
  return fieldValue;
}

function readNullableNonnegativeSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number | null {
  const fieldValue = value[fieldName];

  if (fieldValue === undefined || fieldValue === null) {
    return null;
  }

  return readNonnegativeSafeInteger(value, fieldName);
}
