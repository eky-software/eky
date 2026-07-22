import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDate,
} from '../approvedInvoicePdfFormatting.js';
import {
  drawHorizontalLine,
  invoicePdfLayout,
} from '../approvedInvoicePdfLayout.js';

export function drawPaymentBar(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): void {
  const x = invoicePdfLayout.margin;
  const textY = y + 11;

  drawHorizontalLine(doc, y);
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Viitenumero: ${invoice.referenceNumber}`, x, textY, {
    width: 160,
  });
  doc.text(`Eräpäivä: ${formatPdfDate(invoice.dueDate)}`, x + 174, textY, {
    width: 120,
  });
  doc.text(
    `Yhteensä: ${formatPdfCents(invoice.totals.grossTotalCents)}`,
    x + 312,
    textY,
    {
      width: 199,
      align: 'right',
    },
  );

  drawHorizontalLine(doc, y + 32);
  doc.font('Helvetica').fontSize(9);
}
