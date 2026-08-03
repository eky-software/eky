import type {
  ActivateInvoiceNumberingSeriesRequest,
  InvoiceNumberingSeriesActivationPreviewQuery,
  UpdateInvoiceNumberingSettingsRequest,
} from './invoiceNumberingTypes.js';

export function serializeInvoiceNumberingSettingsInput(
  input: UpdateInvoiceNumberingSettingsRequest,
): UpdateInvoiceNumberingSettingsRequest {
  return {
    mode: input.mode,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    sequencePadding: input.sequencePadding,
    firstSequenceNumber: input.firstSequenceNumber,
  };
}

export function serializeInvoiceNumberingSeriesActivationPreviewQuery(
  query: InvoiceNumberingSeriesActivationPreviewQuery,
): string {
  return new URLSearchParams({
    mode: query.mode,
    fiscalYearStartMonth: String(query.fiscalYearStartMonth),
    sequencePadding: String(query.sequencePadding),
    previewDate: query.previewDate,
  }).toString();
}

export function serializeActivateInvoiceNumberingSeriesInput(
  input: ActivateInvoiceNumberingSeriesRequest,
): ActivateInvoiceNumberingSeriesRequest {
  const serialized: ActivateInvoiceNumberingSeriesRequest = {
    confirmation: input.confirmation,
    currentRevision: input.currentRevision,
    firstSequenceNumber: input.firstSequenceNumber,
    fiscalYearStartMonth: input.fiscalYearStartMonth,
    mode: input.mode,
    reasonCode: input.reasonCode,
    sequencePadding: input.sequencePadding,
  };

  if (input.reasonNote !== undefined) {
    serialized.reasonNote = input.reasonNote;
  }

  return serialized;
}
