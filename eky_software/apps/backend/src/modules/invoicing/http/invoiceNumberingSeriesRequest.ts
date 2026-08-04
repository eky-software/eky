import {
  hasOnlyAllowedFields,
  isRecord,
} from '../../../http/requestBody.js';
import type { ActivateInvoiceNumberingSeriesInput } from '../application/activateInvoiceNumberingSeries.js';
import type { PreviewInvoiceNumberingSeriesActivationInput } from '../application/previewInvoiceNumberingSeriesActivation.js';
import {
  invoiceNumberingSeriesReasonCodes,
  maximumInvoiceNumberingSeriesReasonNoteLength,
  type InvoiceNumberingSeriesReasonCode,
} from '../domain/invoiceNumberingSeries.js';
import type { InvoiceNumberingMode } from '../domain/invoiceNumbering.js';

export type ActivateInvoiceNumberingSeriesRequest = Omit<
  ActivateInvoiceNumberingSeriesInput,
  'actorContext' | 'now'
>;

export type InvoiceNumberingSeriesActivationPreviewQuery = Omit<
  PreviewInvoiceNumberingSeriesActivationInput,
  'actorContext'
>;

const activationFields = new Set([
  'confirmation',
  'currentRevision',
  'firstSequenceNumber',
  'fiscalYearStartMonth',
  'mode',
  'reasonCode',
  'reasonNote',
  'sequencePadding',
]);
const previewQueryFields = new Set([
  'fiscalYearStartMonth',
  'mode',
  'previewDate',
  'sequencePadding',
]);

export class InvoiceNumberingSeriesRequestValidationError extends Error {
  constructor(message = 'Invalid invoice numbering series request.') {
    super(message);
    this.name = 'InvoiceNumberingSeriesRequestValidationError';
  }
}

export function parseActivateInvoiceNumberingSeriesRequest(
  body: unknown,
): ActivateInvoiceNumberingSeriesRequest {
  if (!isRecord(body) || !hasOnlyAllowedFields(body, activationFields)) {
    throw new InvoiceNumberingSeriesRequestValidationError();
  }

  const request: ActivateInvoiceNumberingSeriesRequest = {
    confirmation: readBoundedString(body.confirmation, 1, 100),
    currentRevision: readSafeInteger(body.currentRevision),
    firstSequenceNumber: readSafeInteger(body.firstSequenceNumber),
    fiscalYearStartMonth: readSafeInteger(body.fiscalYearStartMonth),
    mode: readMode(body.mode),
    reasonCode: readReasonCode(body.reasonCode),
    sequencePadding: readSafeInteger(body.sequencePadding),
  };
  const reasonNote = readOptionalReasonNote(body.reasonNote);

  if (reasonNote !== undefined) {
    request.reasonNote = reasonNote;
  }

  return request;
}

export function parseInvoiceNumberingSeriesActivationPreviewQuery(
  searchParams: URLSearchParams,
): InvoiceNumberingSeriesActivationPreviewQuery {
  if (
    [...searchParams.keys()].some(
      (fieldName) => !previewQueryFields.has(fieldName),
    ) ||
    [...previewQueryFields].some(
      (fieldName) => searchParams.getAll(fieldName).length !== 1,
    )
  ) {
    throw new InvoiceNumberingSeriesRequestValidationError(
      'Invalid invoice numbering series preview query.',
    );
  }

  return {
    fiscalYearStartMonth: readIntegerText(
      searchParams.get('fiscalYearStartMonth'),
    ),
    mode: readMode(searchParams.get('mode')),
    previewDate: readIsoCalendarDate(searchParams.get('previewDate')),
    sequencePadding: readIntegerText(searchParams.get('sequencePadding')),
  };
}

function readMode(value: unknown): InvoiceNumberingMode {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw new InvoiceNumberingSeriesRequestValidationError();
}

function readReasonCode(value: unknown): InvoiceNumberingSeriesReasonCode {
  if (
    typeof value === 'string' &&
    invoiceNumberingSeriesReasonCodes.includes(
      value as InvoiceNumberingSeriesReasonCode,
    )
  ) {
    return value as InvoiceNumberingSeriesReasonCode;
  }

  throw new InvoiceNumberingSeriesRequestValidationError();
}

function readSafeInteger(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    return value;
  }

  throw new InvoiceNumberingSeriesRequestValidationError();
}

function readIntegerText(value: string | null): number {
  if (value === null || !/^\d+$/.test(value)) {
    throw new InvoiceNumberingSeriesRequestValidationError(
      'Invalid invoice numbering series preview query.',
    );
  }

  return readSafeInteger(Number(value));
}

function readBoundedString(
  value: unknown,
  minimumLength: number,
  maximumLength: number,
): string {
  if (
    typeof value !== 'string' ||
    value.length < minimumLength ||
    value.length > maximumLength ||
    /[\u0000-\u001F\u007F]/.test(value)
  ) {
    throw new InvoiceNumberingSeriesRequestValidationError();
  }

  return value;
}

function readOptionalReasonNote(value: unknown): string | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }

  return readBoundedString(
    value,
    0,
    maximumInvoiceNumberingSeriesReasonNoteLength,
  );
}

function readIsoCalendarDate(value: string | null): string {
  if (
    value === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !isRoundTripCalendarDate(value)
  ) {
    throw new InvoiceNumberingSeriesRequestValidationError(
      'Invalid invoice numbering series preview query.',
    );
  }

  return value;
}

function isRoundTripCalendarDate(value: string): boolean {
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}
