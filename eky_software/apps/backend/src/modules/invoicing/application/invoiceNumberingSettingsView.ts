import {
  defaultInvoiceNumberSeriesKey,
  type InvoiceNumberingMode,
  type InvoiceNumberingSettings,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';

export interface InvoiceNumberingSettingsView {
  seriesKey: string;
  mode: InvoiceNumberingMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
  hasUsedNumbering: boolean;
  isPersisted: boolean;
}

export const defaultInvoiceNumberingSettings: InvoiceNumberingSettings = {
  mode: 'calendarYearSequence',
  fiscalYearStartMonth: 1,
  sequencePadding: 4,
  firstSequenceNumber: 1,
};

export function toInvoiceNumberingSettingsView(
  settings: StoredInvoiceNumberingSettings | undefined,
  hasUsedNumbering: boolean,
): InvoiceNumberingSettingsView {
  if (settings === undefined) {
    return {
      seriesKey: defaultInvoiceNumberSeriesKey,
      ...defaultInvoiceNumberingSettings,
      hasUsedNumbering: false,
      isPersisted: false,
    };
  }

  return {
    seriesKey: settings.seriesKey,
    mode: settings.mode,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    sequencePadding: settings.sequencePadding,
    firstSequenceNumber: settings.firstSequenceNumber,
    hasUsedNumbering,
    isPersisted: true,
  };
}
