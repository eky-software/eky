import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import { formatPdfDate } from '../approvedInvoicePdfFormatting.js';
import { drawHorizontalLine, invoicePdfLayout } from '../approvedInvoicePdfLayout.js';
import { drawAddressLines } from '../approvedInvoicePdfParty.js';

export function drawHeader(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
): void {
  const leftX = invoicePdfLayout.margin;
  const rightX = 385;

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(invoice.companyNameSnapshot, leftX, 42, { width: 260 });
  doc.font('Helvetica').fontSize(9);
  drawAddressLines(
    doc,
    {
      name: '',
      businessId: invoice.companyBusinessIdSnapshot,
      streetAddress: invoice.companyStreetAddressSnapshot,
      postalCode: invoice.companyPostalCodeSnapshot,
      city: invoice.companyCitySnapshot,
      email: '',
      phone: '',
    },
    leftX,
    64,
    240,
  );

  doc
    .font('Helvetica-Bold')
    .fontSize(16)
    .text(`Lasku: ${invoice.invoiceNumber}`, rightX, 42, {
      width: 166,
      align: 'left',
    });
  doc
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(`Päiväys: ${formatPdfDate(invoice.invoiceDate)}`, rightX, 78, {
      width: 166,
    });

  drawHorizontalLine(doc, 112);
}
