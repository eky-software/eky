import { InvoiceNumberingError } from './invoiceNumberingError.js';

export type InvoiceNumberingMode =
  | 'fiscalYearSequence'
  | 'calendarYearSequence'
  | 'plainSequence';

export interface InvoiceNumberingSettings {
  mode: InvoiceNumberingMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
}

export const maxSequencePadding = 12;
export const maxInvoiceNumberingIdentifierLength = 80;
export const defaultInvoiceNumberSeriesKey = 'default';

export interface StoredInvoiceNumberingSettings
  extends InvoiceNumberingSettings {
  companyId: string;
  seriesKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface InvoiceNumberSequenceState {
  companyId: string;
  seriesKey: string;
  sequenceScope: string;
  lastSequenceNumber: number;
  createdAt: string;
  updatedAt: string;
}

interface InvoiceDateParts {
  year: number;
  month: number;
  day: number;
}

function requireSafeInteger(value: number, fieldName: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new InvoiceNumberingError(`${fieldName} must be a safe integer.`);
  }
}

function requireIntegerInRange(
  value: number,
  fieldName: string,
  minimum: number,
  maximum: number,
): void {
  requireSafeInteger(value, fieldName);

  if (value < minimum || value > maximum) {
    throw new InvoiceNumberingError(
      `${fieldName} must be between ${minimum} and ${maximum}.`,
    );
  }
}

function requireNonEmptyIdentifier(
  value: string,
  fieldName: string,
): void {
  if (value.trim().length === 0) {
    throw new InvoiceNumberingError(`${fieldName} must not be empty.`);
  }

  if (value.length > maxInvoiceNumberingIdentifierLength) {
    throw new InvoiceNumberingError(
      `${fieldName} must be at most ${maxInvoiceNumberingIdentifierLength} characters.`,
    );
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(value)) {
    throw new InvoiceNumberingError(
      `${fieldName} contains unsupported characters.`,
    );
  }
}

function getDaysInMonth(year: number, month: number): number {
  if (month === 2) {
    const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return isLeapYear ? 29 : 28;
  }

  if ([4, 6, 9, 11].includes(month)) {
    return 30;
  }

  return 31;
}

function parseInvoiceDate(invoiceDate: string): InvoiceDateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(invoiceDate);

  if (match === null) {
    throw new InvoiceNumberingError('Invoice date must use YYYY-MM-DD format.');
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (!Number.isSafeInteger(year) || year < 1) {
    throw new InvoiceNumberingError('Invoice date year is invalid.');
  }

  if (!Number.isSafeInteger(month) || month < 1 || month > 12) {
    throw new InvoiceNumberingError('Invoice date month is invalid.');
  }

  const daysInMonth = getDaysInMonth(year, month);

  if (!Number.isSafeInteger(day) || day < 1 || day > daysInMonth) {
    throw new InvoiceNumberingError('Invoice date day is invalid.');
  }

  return { year, month, day };
}

export function validateInvoiceNumberingSettings(
  settings: InvoiceNumberingSettings,
): void {
  if (
    settings.mode !== 'fiscalYearSequence' &&
    settings.mode !== 'calendarYearSequence' &&
    settings.mode !== 'plainSequence'
  ) {
    throw new InvoiceNumberingError(
      'Invoice numbering mode must be fiscalYearSequence, calendarYearSequence, or plainSequence.',
    );
  }

  requireIntegerInRange(
    settings.fiscalYearStartMonth,
    'Fiscal year start month',
    1,
    12,
  );
  requireIntegerInRange(
    settings.sequencePadding,
    'Sequence padding',
    0,
    maxSequencePadding,
  );
  requireIntegerInRange(
    settings.firstSequenceNumber,
    'First sequence number',
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function validateInvoiceSequenceNumber(sequenceNumber: number): void {
  requireIntegerInRange(
    sequenceNumber,
    'Sequence number',
    1,
    Number.MAX_SAFE_INTEGER,
  );
}

export function validateInvoiceNumberSeriesKey(seriesKey: string): void {
  requireNonEmptyIdentifier(seriesKey, 'Invoice number series key');
}

export function validateInvoiceNumberSequenceScope(
  sequenceScope: string,
): void {
  requireNonEmptyIdentifier(sequenceScope, 'Invoice number sequence scope');
}

export function getFiscalYearForInvoiceDate(
  invoiceDate: string,
  fiscalYearStartMonth: number,
): number {
  requireIntegerInRange(
    fiscalYearStartMonth,
    'Fiscal year start month',
    1,
    12,
  );

  const { year, month } = parseInvoiceDate(invoiceDate);

  return month >= fiscalYearStartMonth ? year : year - 1;
}

export function getCalendarYearForInvoiceDate(invoiceDate: string): number {
  return parseInvoiceDate(invoiceDate).year;
}

export function resolveInvoiceNumberSequenceScope(
  settings: InvoiceNumberingSettings,
  invoiceDate: string,
): string {
  validateInvoiceNumberingSettings(settings);

  if (settings.mode === 'plainSequence') {
    return 'plain';
  }

  if (settings.mode === 'calendarYearSequence') {
    return `calendar-year:${getCalendarYearForInvoiceDate(invoiceDate)}`;
  }

  return `fiscal-year:${getFiscalYearForInvoiceDate(
    invoiceDate,
    settings.fiscalYearStartMonth,
  )}`;
}

export function formatSequenceNumber(
  sequenceNumber: number,
  sequencePadding: number,
): string {
  validateInvoiceSequenceNumber(sequenceNumber);
  requireIntegerInRange(
    sequencePadding,
    'Sequence padding',
    0,
    maxSequencePadding,
  );

  return String(sequenceNumber).padStart(sequencePadding, '0');
}

export function formatInvoiceNumber(
  settings: InvoiceNumberingSettings,
  invoiceDate: string,
  sequenceNumber: number,
): string {
  validateInvoiceNumberingSettings(settings);

  const sequencePart = formatSequenceNumber(
    sequenceNumber,
    settings.sequencePadding,
  );

  if (settings.mode === 'plainSequence') {
    return sequencePart;
  }

  if (settings.mode === 'calendarYearSequence') {
    const calendarYear = getCalendarYearForInvoiceDate(invoiceDate);
    return `${String(calendarYear).padStart(4, '0')}${sequencePart}`;
  }

  const fiscalYear = getFiscalYearForInvoiceDate(
    invoiceDate,
    settings.fiscalYearStartMonth,
  );

  return `${String(fiscalYear).padStart(4, '0')}${sequencePart}`;
}
