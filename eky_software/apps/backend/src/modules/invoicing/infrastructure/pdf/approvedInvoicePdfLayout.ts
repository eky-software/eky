export const invoicePdfLayout = {
  pageWidth: 595.28,
  pageHeight: 841.89,
  margin: 42,
  footerTop: 720,
  contentWidth: 511.28,
};

export interface PdfTextLine {
  label?: string;
  value: string;
}

export function drawLabelValueLines(
  doc: PDFKit.PDFDocument,
  lines: PdfTextLine[],
  x: number,
  y: number,
  options: { labelWidth?: number; width?: number; lineGap?: number } = {},
): number {
  const labelWidth = options.labelWidth ?? 86;
  const width = options.width ?? 220;
  const lineGap = options.lineGap ?? 5;
  let currentY = y;

  for (const line of lines) {
    if (line.value.trim().length === 0) {
      continue;
    }

    if (line.label) {
      doc.font('Helvetica-Bold');
      const labelHeight = doc.heightOfString(line.label, {
        width: labelWidth,
      });

      doc.font('Helvetica');
      const valueWidth = width - labelWidth;
      const valueHeight = doc.heightOfString(line.value, {
        width: valueWidth,
      });

      doc.font('Helvetica-Bold').text(line.label, x, currentY, {
        width: labelWidth,
      });
      doc.font('Helvetica').text(line.value, x + labelWidth, currentY, {
        width: valueWidth,
      });

      currentY += Math.max(12, labelHeight, valueHeight);
    } else {
      doc.font('Helvetica');
      const valueHeight = doc.heightOfString(line.value, { width });
      doc.text(line.value, x, currentY, { width });
      currentY += Math.max(12, valueHeight);
    }

    currentY += lineGap;
  }

  return currentY;
}

export function drawBox(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  doc
    .save()
    .lineWidth(0.7)
    .strokeColor('#9fb7d8')
    .roundedRect(x, y, width, height, 3)
    .stroke()
    .restore();
}

export function drawSectionTitle(
  doc: PDFKit.PDFDocument,
  title: string,
  x: number,
  y: number,
  width: number,
): void {
  doc
    .font('Helvetica-Bold')
    .fontSize(10)
    .fillColor('#003f8f')
    .text(title, x, y, { width });
  doc.fillColor('#000000').fontSize(9);
}

export function drawHorizontalLine(
  doc: PDFKit.PDFDocument,
  y: number,
  x = invoicePdfLayout.margin,
  width = invoicePdfLayout.contentWidth,
): void {
  doc
    .save()
    .strokeColor('#5f6f85')
    .lineWidth(0.7)
    .moveTo(x, y)
    .lineTo(x + width, y)
    .stroke()
    .restore();
}
