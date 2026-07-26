import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import {
  formatPdfDate,
  formatPdfIban,
} from '../approvedInvoicePdfFormatting.js';
import { drawBox, invoicePdfLayout } from '../approvedInvoicePdfLayout.js';

interface AdditionalDetailLine {
  label: string;
  value: string;
}

export function drawAdditionalDetails(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const lines = [
    createPerformancePeriodLine(invoice),
    { label: 'Toimitus / kohde', value: invoice.deliveryAddressText },
    { label: 'Lisätieto', value: invoice.note },
    {
      label: 'Palautustili',
      value:
        invoice.invoiceKind === 'credit'
          ? formatPdfIban(invoice.refundIbanSnapshot)
          : '',
    },
  ];
  const visibleLines = lines.filter(
    (line): line is AdditionalDetailLine =>
      line !== null && line.value.trim().length > 0,
  );

  if (visibleLines.length === 0) {
    return y;
  }

  const x = invoicePdfLayout.margin;
  const contentX = x + 10;
  const contentWidth = invoicePdfLayout.contentWidth - 20;
  const labelWidth = 88;
  const topPadding = 6;
  const bottomPadding = topPadding;
  const lineGap = 1.5;
  const valueWidth = contentWidth - labelWidth;
  const rowHeights = visibleLines.map((line) =>
    measureRowHeight(doc, line, labelWidth, valueWidth),
  );
  const contentHeight =
    rowHeights.reduce((height, rowHeight) => height + rowHeight, 0) +
    lineGap * Math.max(0, visibleLines.length - 1);
  const boxHeight = topPadding + contentHeight + bottomPadding;

  drawBox(doc, x, y, invoicePdfLayout.contentWidth, boxHeight);
  drawRows(
    doc,
    visibleLines,
    rowHeights,
    contentX,
    y + topPadding,
    labelWidth,
    valueWidth,
    lineGap,
  );

  return y + boxHeight;
}

function createPerformancePeriodLine(
  invoice: ApprovedInvoiceView,
): AdditionalDetailLine | null {
  if (invoice.performancePeriod.type === 'singleDate') {
    return {
      label: 'Suorituspäivä',
      value: formatPdfDate(invoice.performancePeriod.date),
    };
  }

  if (invoice.performancePeriod.type === 'dateRange') {
    return {
      label: 'Laskutusjakso',
      value: `${formatPdfDate(
        invoice.performancePeriod.startDate,
      )}–${formatPdfDate(invoice.performancePeriod.endDate)}`,
    };
  }

  return null;
}

function measureRowHeight(
  doc: PDFKit.PDFDocument,
  line: AdditionalDetailLine,
  labelWidth: number,
  valueWidth: number,
): number {
  const labelHeight = doc
    .font('Helvetica-Bold')
    .fontSize(8.5)
    .heightOfString(line.label, { width: labelWidth });
  const valueHeight = doc
    .font('Helvetica')
    .fontSize(8.5)
    .heightOfString(line.value, { width: valueWidth });

  return Math.max(labelHeight, valueHeight);
}

function drawRows(
  doc: PDFKit.PDFDocument,
  lines: AdditionalDetailLine[],
  rowHeights: number[],
  x: number,
  y: number,
  labelWidth: number,
  valueWidth: number,
  lineGap: number,
): void {
  let currentY = y;

  lines.forEach((line, index) => {
    doc.font('Helvetica-Bold').fontSize(8.5).text(line.label, x, currentY, {
      width: labelWidth,
    });
    doc.font('Helvetica').fontSize(8.5).text(line.value, x + labelWidth, currentY, {
      width: valueWidth,
    });
    currentY += (rowHeights[index] ?? 0) + lineGap;
  });
}
