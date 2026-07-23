import type { UpdateCreditInvoiceDraftInput } from './invoiceCreditsTypes.js';

export function serializeUpdateCreditInvoiceDraftInput(
  input: UpdateCreditInvoiceDraftInput,
): UpdateCreditInvoiceDraftInput {
  return {
    subject: input.subject,
    note: input.note,
    lines: input.lines.map((line) => ({
      sourceInvoiceLineId: line.sourceInvoiceLineId,
      description: line.description,
      quantityHundredths: line.quantityHundredths,
    })),
  };
}
