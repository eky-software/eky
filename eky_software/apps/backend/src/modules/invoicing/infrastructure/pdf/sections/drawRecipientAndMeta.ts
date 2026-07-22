import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import {
  formatPdfDate,
  formatPdfPercentBasisPoints,
} from '../approvedInvoicePdfFormatting.js';
import {
  drawBox,
  drawLabelValueLines,
  drawSectionTitle,
  invoicePdfLayout,
} from '../approvedInvoicePdfLayout.js';
import { drawParty, getBillingRecipient } from '../approvedInvoicePdfParty.js';

export function drawRecipientAndMeta(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const recipient = getBillingRecipient(invoice);
  const leftX = invoicePdfLayout.margin;
  const rightX = 338;
  const boxHeight = 150;

  drawBox(doc, leftX, y, 270, boxHeight);
  drawSectionTitle(doc, 'Laskun vastaanottaja', leftX + 10, y + 10, 250);
  drawParty(doc, recipient, leftX + 10, y + 30, 250);

  drawBox(doc, rightX, y, 215, boxHeight);
  drawSectionTitle(doc, 'Laskun tiedot', rightX + 10, y + 10, 195);
  drawLabelValueLines(
    doc,
    [
      { label: 'Asiakas', value: invoice.customerNameSnapshot },
      { label: 'Asiakasnumero', value: invoice.customerNumberSnapshot },
      { label: 'Tilausnumero', value: invoice.orderNumber },
      { label: 'Maksuehto', value: `${invoice.paymentTermDays} pv netto` },
      { label: 'Eräpäivä', value: formatPdfDate(invoice.dueDate) },
      {
        label: 'Huom.aika',
        value: `${invoice.reminderPeriodDays} pv`,
      },
      {
        label: 'Viiv.korko',
        value: formatPdfPercentBasisPoints(
          invoice.latePaymentInterestBasisPoints,
        ),
      },
      { label: 'Viitenumero', value: invoice.referenceNumber },
    ],
    rightX + 10,
    y + 31,
    { labelWidth: 78, width: 195, lineGap: 1 },
  );

  return y + boxHeight;
}
