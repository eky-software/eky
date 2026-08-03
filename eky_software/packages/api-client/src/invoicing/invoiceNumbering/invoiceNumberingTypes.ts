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

export type InvoiceNumberingSeriesReasonCode =
  | 'legalRequirement'
  | 'accountingRequirement'
  | 'organizationalChange'
  | 'other';

export interface InvoiceNumberingSeriesSettingsView {
  mode: InvoiceNumberingSettingsMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  firstSequenceNumber: number;
  createdAt: string;
}

export interface InvoiceNumberingSeriesHistoryView {
  previousSeries: InvoiceNumberingSeriesSettingsView;
  replacedAt: string;
}

export interface InvoiceNumberingSeriesOverviewView {
  activeSeries: InvoiceNumberingSeriesSettingsView & {
    activatedAt: string;
  };
  activationConfirmationText: string;
  history: InvoiceNumberingSeriesHistoryView[];
  revision: number;
}

export interface InvoiceNumberingSeriesActivationPreviewQuery {
  mode: InvoiceNumberingSettingsMode;
  fiscalYearStartMonth: number;
  sequencePadding: number;
  previewDate: string;
}

export interface InvoiceNumberingSeriesActivationPreviewView {
  capacity: 'available' | 'exhausted';
  maximumSequenceNumber: number;
  minimumFirstSequenceNumber: number | null;
  previewDate: string;
  previewInvoiceNumber: string | null;
}

export interface ActivateInvoiceNumberingSeriesRequest {
  confirmation: string;
  currentRevision: number;
  firstSequenceNumber: number;
  fiscalYearStartMonth: number;
  mode: InvoiceNumberingSettingsMode;
  reasonCode: InvoiceNumberingSeriesReasonCode;
  reasonNote?: string | null;
  sequencePadding: number;
}

export interface InvoiceNumberingSettingsApi {
  getInvoiceNumberingSettings(): Promise<InvoiceNumberingSettingsView>;
  updateInvoiceNumberingSettings(
    input: UpdateInvoiceNumberingSettingsRequest,
  ): Promise<InvoiceNumberingSettingsView>;
  getInvoiceNumberingSeriesOverview(): Promise<InvoiceNumberingSeriesOverviewView>;
  previewInvoiceNumberingSeriesActivation(
    query: InvoiceNumberingSeriesActivationPreviewQuery,
  ): Promise<InvoiceNumberingSeriesActivationPreviewView>;
  activateInvoiceNumberingSeries(
    input: ActivateInvoiceNumberingSeriesRequest,
  ): Promise<InvoiceNumberingSeriesOverviewView>;
}
