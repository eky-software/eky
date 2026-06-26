import type {
  InvoiceNumberingSettingsMode,
  InvoiceNumberingSettingsView,
  UpdateInvoiceNumberingSettingsRequest,
} from '@eky/api-client';

export interface InvoiceNumberingSettingsForm {
  mode: InvoiceNumberingSettingsMode;
  fiscalYearStartMonth: string;
  sequencePadding: string;
  firstSequenceNumber: string;
}

export interface InvoiceNumberingSettingsValidationErrors {
  mode?: string;
  fiscalYearStartMonth?: string;
  sequencePadding?: string;
  firstSequenceNumber?: string;
}

export const invoiceNumberingModeOptions: InvoiceNumberingSettingsMode[] = [
  'calendarYearSequence',
  'fiscalYearSequence',
  'plainSequence',
];

export const monthOptions = [
  { labelKey: 'january', value: 1 },
  { labelKey: 'february', value: 2 },
  { labelKey: 'march', value: 3 },
  { labelKey: 'april', value: 4 },
  { labelKey: 'may', value: 5 },
  { labelKey: 'june', value: 6 },
  { labelKey: 'july', value: 7 },
  { labelKey: 'august', value: 8 },
  { labelKey: 'september', value: 9 },
  { labelKey: 'october', value: 10 },
  { labelKey: 'november', value: 11 },
  { labelKey: 'december', value: 12 },
] as const;

export const initialInvoiceNumberingSettingsForm: InvoiceNumberingSettingsForm = {
  mode: 'calendarYearSequence',
  fiscalYearStartMonth: '1',
  sequencePadding: '3',
  firstSequenceNumber: '1',
};

export function toInvoiceNumberingSettingsForm(
  settings: InvoiceNumberingSettingsView,
): InvoiceNumberingSettingsForm {
  return {
    mode: settings.mode,
    fiscalYearStartMonth: String(settings.fiscalYearStartMonth),
    sequencePadding: String(settings.sequencePadding),
    firstSequenceNumber: String(settings.firstSequenceNumber),
  };
}

export function validateInvoiceNumberingSettingsForm(
  form: InvoiceNumberingSettingsForm,
  messages: {
    firstSequenceNumberInvalid: string;
    fiscalYearStartMonthInvalid: string;
    modeInvalid: string;
    sequencePaddingInvalid: string;
  },
): InvoiceNumberingSettingsValidationErrors {
  const errors: InvoiceNumberingSettingsValidationErrors = {};

  if (!invoiceNumberingModeOptions.includes(form.mode)) {
    errors.mode = messages.modeInvalid;
  }

  const fiscalYearStartMonth = parseIntegerInput(form.fiscalYearStartMonth);
  if (
    fiscalYearStartMonth === null ||
    fiscalYearStartMonth < 1 ||
    fiscalYearStartMonth > 12
  ) {
    errors.fiscalYearStartMonth = messages.fiscalYearStartMonthInvalid;
  }

  const sequencePadding = parseIntegerInput(form.sequencePadding);
  if (sequencePadding === null || sequencePadding < 0 || sequencePadding > 12) {
    errors.sequencePadding = messages.sequencePaddingInvalid;
  }

  const firstSequenceNumber = parseIntegerInput(form.firstSequenceNumber);
  if (firstSequenceNumber === null || firstSequenceNumber < 1) {
    errors.firstSequenceNumber = messages.firstSequenceNumberInvalid;
  }

  return errors;
}

export function hasInvoiceNumberingSettingsValidationErrors(
  errors: InvoiceNumberingSettingsValidationErrors,
): boolean {
  return Object.values(errors).some((error) => error !== undefined);
}

export function toUpdateInvoiceNumberingSettingsRequest(
  form: InvoiceNumberingSettingsForm,
): UpdateInvoiceNumberingSettingsRequest {
  const fiscalYearStartMonth = parseIntegerInput(form.fiscalYearStartMonth);
  const sequencePadding = parseIntegerInput(form.sequencePadding);
  const firstSequenceNumber = parseIntegerInput(form.firstSequenceNumber);

  if (
    fiscalYearStartMonth === null ||
    sequencePadding === null ||
    firstSequenceNumber === null
  ) {
    throw new Error('Invalid invoice numbering settings form.');
  }

  return {
    mode: form.mode,
    fiscalYearStartMonth,
    sequencePadding,
    firstSequenceNumber,
  };
}

function parseIntegerInput(value: string): number | null {
  const trimmedValue = value.trim();

  if (!/^\d+$/.test(trimmedValue)) {
    return null;
  }

  const parsedValue = Number(trimmedValue);

  return Number.isSafeInteger(parsedValue) ? parsedValue : null;
}
