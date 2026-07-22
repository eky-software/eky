import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDiscount,
  formatPdfQuantity,
} from '../approvedInvoicePdfFormatting.js';
import {
  drawHorizontalLine,
  invoicePdfLayout,
} from '../approvedInvoicePdfLayout.js';

interface InvoiceLineColumn {
  label: string;
  x: number;
  width: number;
  align: 'left' | 'right';
}

interface InvoiceLineColumns {
  code: InvoiceLineColumn;
  description: InvoiceLineColumn;
  quantity: InvoiceLineColumn;
  unit: InvoiceLineColumn;
  unitPrice: InvoiceLineColumn;
  lineTotal: InvoiceLineColumn;
}

export function drawInvoiceLines(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const x = invoicePdfLayout.margin;
  const columns = createInvoiceLineColumns(x, invoice.priceInputMode);
  let currentY = drawInvoiceLinesHeader(doc, columns, y);

  for (const line of invoice.lines) {
    const rowHeight = calculateLineHeight(doc, line);

    if (currentY + rowHeight > invoicePdfLayout.footerTop - 20) {
      doc.addPage();
      currentY = drawInvoiceLinesHeader(doc, columns, invoicePdfLayout.margin);
    }

    drawLineRow(doc, line, columns, currentY, invoice.priceInputMode);
    currentY += rowHeight;
  }

  drawHorizontalLine(doc, currentY - 2);

  return currentY;
}

function drawInvoiceLinesHeader(
  doc: PDFKit.PDFDocument,
  columns: InvoiceLineColumns,
  y: number,
): number {
  const x = invoicePdfLayout.margin;
  let currentY = y;

  doc.font('Helvetica-Bold').fontSize(10).text('Laskurivit', x, currentY);
  currentY += 18;
  drawHorizontalLine(doc, currentY - 5);
  doc.font('Helvetica-Bold').fontSize(8);
  for (const column of getInvoiceLineColumnList(columns)) {
    doc.text(column.label, column.x, currentY, {
      width: column.width,
      align: column.align,
    });
  }
  currentY += 16;
  drawHorizontalLine(doc, currentY - 6);
  doc.font('Helvetica').fontSize(8.5);

  return currentY;
}

function drawLineRow(
  doc: PDFKit.PDFDocument,
  line: ApprovedInvoiceViewLine,
  columns: InvoiceLineColumns,
  y: number,
  priceInputMode: ApprovedInvoiceView['priceInputMode'],
): void {
  const unitPrice =
    priceInputMode === 'gross'
      ? line.unitPriceCents
      : line.unitPriceCents;
  const lineTotal =
    priceInputMode === 'gross' ? line.grossCents : line.netCents;

  doc.text(line.code, columns.code.x, y, {
    width: columns.code.width,
    align: columns.code.align,
  });
  doc.text(line.description, columns.description.x, y, {
    width: columns.description.width,
    align: columns.description.align,
  });
  doc.text(formatPdfQuantity(line.quantityHundredths), columns.quantity.x, y, {
    width: columns.quantity.width,
    align: columns.quantity.align,
  });
  doc.text(line.unit, columns.unit.x, y, {
    width: columns.unit.width,
    align: columns.unit.align,
  });
  doc.text(formatPdfCents(unitPrice), columns.unitPrice.x, y, {
    width: columns.unitPrice.width,
    align: columns.unitPrice.align,
  });
  doc.text(formatPdfCents(lineTotal), columns.lineTotal.x, y, {
    width: columns.lineTotal.width,
    align: columns.lineTotal.align,
  });

  const discount = formatPdfDiscount(line.discount);
  if (discount.length > 0) {
    doc
      .fontSize(7)
      .fillColor('#4f6075')
      .text(`Alennus ${discount}`, columns.description.x, y + 12, {
        width: columns.description.width,
      })
      .fillColor('#000000')
      .fontSize(8.5);
  }
}

function calculateLineHeight(
  doc: PDFKit.PDFDocument,
  line: ApprovedInvoiceViewLine,
): number {
  const descriptionHeight = doc.heightOfString(line.description, {
    width: 235,
  });
  const discountExtra = line.discount.type === 'none' ? 0 : 10;

  return Math.max(17, descriptionHeight + discountExtra + 5);
}

function createInvoiceLineColumns(
  x: number,
  priceInputMode: ApprovedInvoiceView['priceInputMode'],
): InvoiceLineColumns {
  return {
    code: { label: 'Koodi', x, width: 55, align: 'left' },
    description: { label: 'Nimike', x: x + 58, width: 235, align: 'left' },
    quantity: { label: 'Määrä', x: x + 298, width: 42, align: 'right' },
    unit: { label: 'Yks', x: x + 345, width: 28, align: 'left' },
    unitPrice: {
      label: priceInputMode === 'gross' ? 'A-hinta sis. alv' : 'A-hinta alv 0',
      x: x + 374,
      width: 74,
      align: 'right',
    },
    lineTotal: {
      label: 'Yht. EUR',
      x: x + 452,
      width: 59,
      align: 'right',
    },
  };
}

function getInvoiceLineColumnList(
  columns: InvoiceLineColumns,
): InvoiceLineColumn[] {
  return [
    columns.code,
    columns.description,
    columns.quantity,
    columns.unit,
    columns.unitPrice,
    columns.lineTotal,
  ];
}
