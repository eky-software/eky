import PDFDocument from 'pdfkit';

import type { ApprovedInvoiceView } from '../../domain/approvedInvoiceView.js';
import { invoicePdfLayout } from './approvedInvoicePdfLayout.js';
import { drawAdditionalDetails } from './sections/drawAdditionalDetails.js';
import { drawFooter } from './sections/drawFooter.js';
import { drawHeader } from './sections/drawHeader.js';
import { drawInvoiceLines } from './sections/drawInvoiceLines.js';
import { drawPageNumbers } from './sections/drawPageNumbers.js';
import { drawPaymentBar } from './sections/drawPaymentBar.js';
import { drawRecipientAndMeta } from './sections/drawRecipientAndMeta.js';
import { drawVatAndTotals } from './sections/drawVatAndTotals.js';

export async function renderApprovedInvoicePdf(
  invoice: ApprovedInvoiceView,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: invoicePdfLayout.margin,
      autoFirstPage: true,
      bufferPages: true,
    });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on('end', () => {
      resolve(Uint8Array.from(Buffer.concat(chunks)));
    });
    doc.on('error', reject);

    drawInvoice(doc, invoice);
    doc.end();
  });
}

function drawInvoice(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
): void {
  doc.font('Helvetica').fontSize(9).fillColor('#000000');

  drawHeader(doc, invoice);

  const metaBottom = drawRecipientAndMeta(doc, invoice, 128);
  const detailsBottom = drawAdditionalDetails(doc, invoice, metaBottom + 10);
  const linesBottom = drawInvoiceLines(doc, invoice, detailsBottom + 16);
  const totalsBottom = drawVatAndTotals(doc, invoice, linesBottom + 18);

  if (invoice.invoiceKind === 'standard') {
    drawPaymentBar(doc, invoice, Math.max(totalsBottom + 18, 628));
  }
  drawFooter(doc, invoice);
  drawPageNumbers(doc);
}
