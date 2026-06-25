import {
  defaultInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
  type InvoiceNumberingMode,
  type InvoiceNumberingSettings,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import { InvoiceNumberingSettingsError } from './invoiceNumberingSettingsError.js';
import {
  toInvoiceNumberingSettingsView,
  type InvoiceNumberingSettingsView,
} from './invoiceNumberingSettingsView.js';

export interface UpdateInvoiceNumberingSettingsInput {
  companyId: string;
  mode: InvoiceNumberingMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
  now: string;
}

function requireNonEmptyValue(value: string, fieldName: string): string {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0) {
    throw new InvoiceNumberingSettingsError(`${fieldName} is required.`);
  }

  return normalizedValue;
}

function toNumberingSettings(
  input: UpdateInvoiceNumberingSettingsInput,
): InvoiceNumberingSettings {
  return {
    mode: input.mode,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    sequencePadding: input.sequencePadding,
    firstSequenceNumber: input.firstSequenceNumber,
  };
}

function settingsAreEqual(
  currentSettings: InvoiceNumberingSettings,
  nextSettings: InvoiceNumberingSettings,
): boolean {
  return (
    currentSettings.mode === nextSettings.mode &&
    currentSettings.fiscalYearStartMonth === nextSettings.fiscalYearStartMonth &&
    currentSettings.sequencePadding === nextSettings.sequencePadding &&
    currentSettings.firstSequenceNumber === nextSettings.firstSequenceNumber
  );
}

function createStoredSettings(
  input: UpdateInvoiceNumberingSettingsInput,
  currentSettings: StoredInvoiceNumberingSettings | undefined,
): StoredInvoiceNumberingSettings {
  return {
    companyId: requireNonEmptyValue(input.companyId, 'Company id'),
    seriesKey: defaultInvoiceNumberSeriesKey,
    ...toNumberingSettings(input),
    createdAt: currentSettings?.createdAt ?? requireNonEmptyValue(input.now, 'Timestamp'),
    updatedAt: requireNonEmptyValue(input.now, 'Timestamp'),
  };
}

export async function updateInvoiceNumberingSettings(
  input: UpdateInvoiceNumberingSettingsInput,
  invoiceNumberingSettingsRepository: InvoiceNumberingSettingsRepository,
): Promise<InvoiceNumberingSettingsView> {
  const companyId = requireNonEmptyValue(input.companyId, 'Company id');
  const now = requireNonEmptyValue(input.now, 'Timestamp');
  const nextSettings = toNumberingSettings({ ...input, companyId, now });

  validateInvoiceNumberingSettings(nextSettings);

  const currentSettings = await invoiceNumberingSettingsRepository.getSettings(
    companyId,
    defaultInvoiceNumberSeriesKey,
  );
  const hasUsedNumbering =
    currentSettings === undefined
      ? false
      : await invoiceNumberingSettingsRepository.hasUsedNumbering(
        companyId,
        defaultInvoiceNumberSeriesKey,
      );

  if (currentSettings !== undefined) {
    validateInvoiceNumberingSettings(currentSettings);
  }

  if (
    hasUsedNumbering &&
    currentSettings !== undefined &&
    !settingsAreEqual(currentSettings, nextSettings)
  ) {
    throw new InvoiceNumberingSettingsError(
      'Invoice numbering settings cannot be changed after numbering has been used.',
    );
  }

  const savedSettings = await invoiceNumberingSettingsRepository.saveSettings(
    createStoredSettings(
      { ...input, companyId, now },
      currentSettings,
    ),
  );

  validateInvoiceNumberingSettings(savedSettings);

  return toInvoiceNumberingSettingsView(savedSettings, hasUsedNumbering);
}
