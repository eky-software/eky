import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfPercentBasisPoints,
} from '../approvedInvoicePdfFormatting.js';
import { invoicePdfLayout } from '../approvedInvoicePdfLayout.js';

export function drawVatAndTotals(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const x = invoicePdfLayout.margin;
  const totalsX = 342;
  let currentY = y;

  doc.font('Helvetica-Bold').fontSize(10).text('ALV-erittely', x, currentY);
  currentY += 18;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('ALV %', x, currentY, { width: 55 });
  doc.text('Veroton', x + 88, currentY, { width: 82, align: 'right' });
  doc.text('ALV', x + 208, currentY, { width: 82, align: 'right' });
  currentY += 14;
  doc.font('Helvetica').fontSize(8.5);

  for (const vat of invoice.vatBreakdown) {
    doc.text(formatPdfPercentBasisPoints(vat.vatRateBasisPoints), x, currentY, {
      width: 55,
    });
    doc.text(formatPdfCents(vat.netCents), x + 88, currentY, {
      width: 82,
      align: 'right',
    });
    doc.text(formatPdfCents(vat.vatCents), x + 208, currentY, {
      width: 82,
      align: 'right',
    });
    currentY += 14;
  }

  const lastVatRowY = currentY - 14;
  const grandTotalY = Math.max(y + 32, lastVatRowY);
  const totalsY = grandTotalY - 32;
  drawTotalsLine(
    doc,
    'Yhteensä ilman alv',
    formatPdfCents(invoice.totals.netTotalCents),
    totalsX,
    totalsY,
  );
  drawTotalsLine(
    doc,
    'Alv yhteensä',
    formatPdfCents(invoice.totals.vatTotalCents),
    totalsX,
    totalsY + 18,
  );
  drawTotalsLine(
    doc,
    'Loppusumma EUR',
    formatPdfCents(invoice.totals.grossTotalCents),
    totalsX,
    totalsY + 32,
    true,
  );
  doc.font('Helvetica').fontSize(9);

  return Math.max(currentY, grandTotalY + 18);
}

function drawTotalsLine(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  strong = false,
): void {
  doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10 : 9);
  doc.text(label, x, y, { width: 118 });
  doc.text(value, x + 118, y, {
    width: 90,
    align: 'right',
  });
}
