export type InvoiceNumberingSettingsMode =
  | 'calendarYearSequence'
  | 'fiscalYearSequence'
  | 'plainSequence';

export interface InvoiceNumberingSettingsView {
  seriesKey: string;
  mode: InvoiceNumberingSettingsMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
  hasUsedNumbering: boolean;
  isPersisted: boolean;
}

export interface UpdateInvoiceNumberingSettingsRequest {
  mode: InvoiceNumberingSettingsMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
}

export interface InvoiceNumberingSettingsApi {
  getInvoiceNumberingSettings(): Promise<InvoiceNumberingSettingsView>;
  updateInvoiceNumberingSettings(
    input: UpdateInvoiceNumberingSettingsRequest,
  ): Promise<InvoiceNumberingSettingsView>;
}
