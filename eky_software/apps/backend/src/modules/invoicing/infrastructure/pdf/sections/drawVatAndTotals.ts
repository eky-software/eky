import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import {
  formatPdfPercentBasisPoints,
  formatPdfPresentedCents,
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

  if (invoice.taxTreatment === 'reverseChargeConstruction') {
    return drawReverseChargeTotals(doc, invoice, currentY, x, totalsX);
  }

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
    doc.text(formatPdfPresentedCents(vat.netCents, invoice.invoiceKind), x + 88, currentY, {
      width: 82,
      align: 'right',
    });
    doc.text(formatPdfPresentedCents(vat.vatCents, invoice.invoiceKind), x + 208, currentY, {
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
    formatPdfPresentedCents(invoice.totals.netTotalCents, invoice.invoiceKind),
    totalsX,
    totalsY,
  );
  drawTotalsLine(
    doc,
    'Alv yhteensä',
    formatPdfPresentedCents(invoice.totals.vatTotalCents, invoice.invoiceKind),
    totalsX,
    totalsY + 18,
  );
  drawTotalsLine(
    doc,
    'Loppusumma EUR',
    formatPdfPresentedCents(invoice.totals.grossTotalCents, invoice.invoiceKind),
    totalsX,
    totalsY + 32,
    true,
  );
  doc.font('Helvetica').fontSize(9);

  return Math.max(currentY, grandTotalY + 18);
}

function drawReverseChargeTotals(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
  x: number,
  totalsX: number,
): number {
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(invoice.taxTreatmentLabelSnapshot, x, y, { width: 250 });
  doc
    .font('Helvetica')
    .fontSize(8.5)
    .text(invoice.taxLegalBasisSnapshot, x, y + 18, { width: 250 });

  drawTotalsLine(
    doc,
    'Veroton yhteensä',
    formatPdfPresentedCents(
      invoice.totals.netTotalCents,
      invoice.invoiceKind,
    ),
    totalsX,
    y,
  );
  drawTotalsLine(
    doc,
    'Loppusumma EUR',
    formatPdfPresentedCents(
      invoice.totals.grossTotalCents,
      invoice.invoiceKind,
    ),
    totalsX,
    y + 22,
    true,
  );
  doc.font('Helvetica').fontSize(9);

  return y + 40;
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
