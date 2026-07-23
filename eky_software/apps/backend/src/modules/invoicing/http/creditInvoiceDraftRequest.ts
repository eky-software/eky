import type { ActorContext } from '@eky/auth';

import type { CreditInvoiceDraftLineInput } from '../application/creditInvoiceDraftModel.js';
import type { UpdateCreditInvoiceDraftInput } from '../application/updateCreditInvoiceDraft.js';

const maximumLineCount = 500;
const maximumIdentifierLength = 200;
const maximumShortTextLength = 500;
const maximumLongTextLength = 5_000;
const creditDraftFields = new Set(['subject', 'note', 'lines']);
const creditDraftLineFields = new Set([
  'sourceInvoiceLineId',
  'description',
  'quantityHundredths',
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
    lines: body.lines.map(readCreditDraftLine),
  };
}

function readCreditDraftLine(value: unknown): CreditInvoiceDraftLineInput {
  if (!isRecord(value)) {
    throw new CreditInvoiceDraftRequestValidationError();
  }

  assertAllowedFields(value, creditDraftLineFields);

  return {
    sourceInvoiceLineId: readString(
      value,
      'sourceInvoiceLineId',
      maximumIdentifierLength,
    ),
    description: readString(value, 'description', maximumLongTextLength),
    quantityHundredths: readSafeInteger(value, 'quantityHundredths'),
  };
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
