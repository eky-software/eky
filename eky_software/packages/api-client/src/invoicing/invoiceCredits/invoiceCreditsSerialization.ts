import type { UpdateCreditInvoiceDraftInput } from './invoiceCreditsTypes.js';

export function serializeUpdateCreditInvoiceDraftInput(
  input: UpdateCreditInvoiceDraftInput,
): UpdateCreditInvoiceDraftInput {
  return {
    subject: input.subject,
    note: input.note,
    refundIban: input.refundIban,
    lines: input.lines.map((line) =>
      line.lineType === 'source'
        ? {
            lineType: line.lineType,
            sourceInvoiceLineId: line.sourceInvoiceLineId,
            description: line.description,
            quantityHundredths: line.quantityHundredths,
          }
        : {
            lineType: line.lineType,
            description: line.description,
            quantityHundredths: line.quantityHundredths,
            unit: line.unit,
            unitPriceCents: line.unitPriceCents,
            vatRateBasisPoints: line.vatRateBasisPoints,
          },
    ),
  };
}
