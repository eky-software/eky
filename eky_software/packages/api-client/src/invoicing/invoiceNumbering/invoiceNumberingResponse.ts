import { EkyApiError, isRecord } from '../../http.js';
import type {
  InvoiceNumberingSettingsMode,
  InvoiceNumberingSettingsView,
  InvoiceNumberingSeriesActivationPreviewView,
  InvoiceNumberingSeriesOverviewView,
  InvoiceNumberingSeriesSettingsView,
} from './invoiceNumberingTypes.js';

export function readInvoiceNumberingSettingsResponse(
  responseBody: unknown,
): InvoiceNumberingSettingsView {
  if (!isRecord(responseBody)) {
    throw invalidInvoiceNumberingSettingsResponse(responseBody);
  }

  return parseInvoiceNumberingSettingsView(
    responseBody.invoiceNumberingSettings,
  );
}

export function readInvoiceNumberingSeriesOverviewResponse(
  responseBody: unknown,
): InvoiceNumberingSeriesOverviewView {
  if (
    !isRecord(responseBody) ||
    !hasOnlyKeys(responseBody, ['invoiceNumberingSeriesOverview'])
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  return parseInvoiceNumberingSeriesOverview(
    responseBody.invoiceNumberingSeriesOverview,
    responseBody,
  );
}

export function readInvoiceNumberingSeriesActivationPreviewResponse(
  responseBody: unknown,
): InvoiceNumberingSeriesActivationPreviewView {
  if (
    !isRecord(responseBody) ||
    !hasOnlyKeys(responseBody, ['invoiceNumberingSeriesActivationPreview'])
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  const value = responseBody.invoiceNumberingSeriesActivationPreview;

  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'capacity',
      'maximumSequenceNumber',
      'minimumFirstSequenceNumber',
      'previewDate',
      'previewInvoiceNumber',
    ]) ||
    (value.capacity !== 'available' && value.capacity !== 'exhausted') ||
    !isNonNegativeSafeInteger(value.maximumSequenceNumber) ||
    !isNullablePositiveSafeInteger(value.minimumFirstSequenceNumber) ||
    !isCalendarDate(value.previewDate) ||
    !isNullableString(value.previewInvoiceNumber)
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  if (
    (value.capacity === 'available' &&
      (value.minimumFirstSequenceNumber === null ||
        value.previewInvoiceNumber === null)) ||
    (value.capacity === 'exhausted' &&
      (value.minimumFirstSequenceNumber !== null ||
        value.previewInvoiceNumber !== null))
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  return {
    capacity: value.capacity,
    maximumSequenceNumber: value.maximumSequenceNumber,
    minimumFirstSequenceNumber: value.minimumFirstSequenceNumber,
    previewDate: value.previewDate,
    previewInvoiceNumber: value.previewInvoiceNumber,
  };
}

function parseInvoiceNumberingSettingsView(
  value: unknown,
): InvoiceNumberingSettingsView {
  if (!isRecord(value)) {
    throw invalidInvoiceNumberingSettingsResponse(value);
  }

  return {
    seriesKey: readString(value, 'seriesKey'),
    mode: parseInvoiceNumberingSettingsMode(value.mode),
    fiscalYearStartMonth: readSafeInteger(value, 'fiscalYearStartMonth'),
    sequencePadding: readSafeInteger(value, 'sequencePadding'),
    firstSequenceNumber: readSafeInteger(value, 'firstSequenceNumber'),
    hasUsedNumbering: readBoolean(value, 'hasUsedNumbering'),
    isPersisted: readBoolean(value, 'isPersisted'),
  };
}

function parseInvoiceNumberingSeriesOverview(
  value: unknown,
  responseBody: unknown,
): InvoiceNumberingSeriesOverviewView {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'activeSeries',
      'activationConfirmationText',
      'history',
      'revision',
    ]) ||
    !Array.isArray(value.history) ||
    !isPositiveSafeInteger(value.revision) ||
    typeof value.activationConfirmationText !== 'string' ||
    value.activationConfirmationText.length < 1 ||
    value.activationConfirmationText.length > 200
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  const activeSeries = parseInvoiceNumberingSeriesSettings(
    value.activeSeries,
    responseBody,
    true,
  );

  return {
    activeSeries: {
      ...activeSeries.settings,
      activatedAt: activeSeries.extraTimestamp,
    },
    activationConfirmationText: value.activationConfirmationText,
    history: value.history.map((entry) => {
      if (
        !isRecord(entry) ||
        !hasOnlyKeys(entry, ['previousSeries', 'replacedAt']) ||
        !isTimestamp(entry.replacedAt)
      ) {
        throw invalidInvoiceNumberingSeriesResponse(responseBody);
      }

      return {
        previousSeries: parseInvoiceNumberingSeriesSettings(
          entry.previousSeries,
          responseBody,
          false,
        ).settings,
        replacedAt: entry.replacedAt,
      };
    }),
    revision: value.revision,
  };
}

function parseInvoiceNumberingSeriesSettings(
  value: unknown,
  responseBody: unknown,
  withActivatedAt: boolean,
): {
  settings: InvoiceNumberingSeriesSettingsView;
  extraTimestamp: string;
} {
  const keys = [
    'mode',
    'fiscalYearStartMonth',
    'sequencePadding',
    'firstSequenceNumber',
    'createdAt',
    ...(withActivatedAt ? ['activatedAt'] : []),
  ];

  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, keys) ||
    !isTimestamp(value.createdAt) ||
    (withActivatedAt && !isTimestamp(value.activatedAt))
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  const fiscalYearStartMonth = readSafeInteger(
    value,
    'fiscalYearStartMonth',
  );
  const sequencePadding = readSafeInteger(value, 'sequencePadding');
  const firstSequenceNumber = readSafeInteger(
    value,
    'firstSequenceNumber',
  );

  if (
    fiscalYearStartMonth < 1 ||
    fiscalYearStartMonth > 12 ||
    sequencePadding < 0 ||
    sequencePadding > 12 ||
    firstSequenceNumber < 1
  ) {
    throw invalidInvoiceNumberingSeriesResponse(responseBody);
  }

  return {
    settings: {
      mode: parseInvoiceNumberingSettingsMode(value.mode),
      fiscalYearStartMonth,
      sequencePadding,
      firstSequenceNumber,
      createdAt: value.createdAt,
    },
    extraTimestamp: withActivatedAt ? (value.activatedAt as string) : '',
  };
}

function parseInvoiceNumberingSettingsMode(
  value: unknown,
): InvoiceNumberingSettingsMode {
  if (
    value === 'calendarYearSequence' ||
    value === 'fiscalYearSequence' ||
    value === 'plainSequence'
  ) {
    return value;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function readString(value: Record<string, unknown>, fieldName: string): string {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'string') {
    return fieldValue;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function readSafeInteger(
  value: Record<string, unknown>,
  fieldName: string,
): number {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'number' && Number.isSafeInteger(fieldValue)) {
    return fieldValue;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function readBoolean(
  value: Record<string, unknown>,
  fieldName: string,
): boolean {
  const fieldValue = value[fieldName];

  if (typeof fieldValue === 'boolean') {
    return fieldValue;
  }

  throw invalidInvoiceNumberingSettingsResponse(value);
}

function invalidInvoiceNumberingSettingsResponse(
  responseBody: unknown,
): EkyApiError {
  return new EkyApiError('Invalid invoice numbering settings response.', {
    responseBody,
  });
}

function invalidInvoiceNumberingSeriesResponse(
  responseBody: unknown,
): EkyApiError {
  return new EkyApiError('Invalid invoice numbering series response.', {
    responseBody,
  });
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowedKeys: readonly string[],
): boolean {
  return Object.keys(value).every((key) => allowedKeys.includes(key));
}

function isPositiveSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

function isNullablePositiveSafeInteger(
  value: unknown,
): value is number | null {
  return value === null || isPositiveSafeInteger(value);
}

function isNullableString(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === 'string' && value.length > 0 && value.length <= 200)
  );
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 64 &&
    !Number.isNaN(Date.parse(value))
  );
}

function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() + 1 === month &&
    date.getUTCDate() === day
  );
}
