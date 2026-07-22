export function drawPageNumbers(doc: PDFKit.PDFDocument): void {
  const pageRange = doc.bufferedPageRange();

  for (let index = 0; index < pageRange.count; index += 1) {
    doc.switchToPage(pageRange.start + index);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#4f6075')
      .text(`Sivu ${index + 1} / ${pageRange.count}`, 460, 24, {
        width: 90,
        align: 'right',
      })
      .fillColor('#000000');
  }
}
