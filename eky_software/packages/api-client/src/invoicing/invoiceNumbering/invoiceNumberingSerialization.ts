import type {
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
