import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import {
  drawBox,
  drawLabelValueLines,
  invoicePdfLayout,
} from '../approvedInvoicePdfLayout.js';

export function drawAdditionalDetails(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const lines = [
    { label: 'Toimitus / kohde', value: invoice.deliveryAddressText },
    { label: 'Lisätieto', value: invoice.note },
  ];
  const visibleLines = lines.filter((line) => line.value.trim().length > 0);

  if (visibleLines.length === 0) {
    return y;
  }

  const x = invoicePdfLayout.margin;
  const contentX = x + 10;
  const contentWidth = invoicePdfLayout.contentWidth - 20;
  const labelWidth = 88;
  const valueWidth = contentWidth - labelWidth;
  const contentHeight = visibleLines.reduce(
    (height, line) =>
      height +
      Math.max(
        12,
        doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(line.label, {
          width: labelWidth,
        }),
        doc.font('Helvetica').fontSize(8.5).heightOfString(line.value, {
          width: valueWidth,
        }),
      ) +
      2,
    0,
  );
  const boxHeight = Math.max(32, contentHeight + 16);

  drawBox(doc, x, y, invoicePdfLayout.contentWidth, boxHeight);
  doc.fontSize(8.5);
  drawLabelValueLines(doc, visibleLines, contentX, y + 9, {
    labelWidth,
    width: contentWidth,
    lineGap: 2,
  });

  return y + boxHeight;
}
