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
  const contentTop = y + 30;
  const contentBottomPadding = 8;
  const lineGap = 1;

  drawSectionTitle(doc, 'Laskun vastaanottaja', leftX + 10, y + 10, 250);
  const recipientBottom = drawParty(
    doc,
    recipient,
    leftX + 10,
    contentTop,
    250,
  );

  drawSectionTitle(doc, 'Laskun tiedot', rightX + 10, y + 10, 195);
  const invoiceMetadata =
    invoice.invoiceKind === 'credit'
      ? [
          { label: 'Asiakas', value: invoice.customerNameSnapshot },
          { label: 'Asiakasnumero', value: invoice.customerNumberSnapshot },
          { label: 'Tilausnumero', value: invoice.orderNumber },
          {
            label: 'Hyvittää laskua',
            value: invoice.creditedInvoiceNumber ?? '',
          },
          {
            label: 'Laskun päiväys',
            value:
              invoice.creditedInvoiceDate === null
                ? ''
                : formatPdfDate(invoice.creditedInvoiceDate),
          },
        ]
      : [
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
        ];
  if (invoice.taxTreatment === 'reverseChargeConstruction') {
    invoiceMetadata.push(
      {
        label: 'Verokäsittely',
        value: invoice.taxTreatmentLabelSnapshot,
      },
      {
        label: 'Peruste',
        value: invoice.taxLegalBasisSnapshot,
      },
      {
        label: 'Ostajan Y-tunnus',
        value: invoice.customerBusinessIdSnapshot,
      },
    );
  }
  const metadataBottom = drawLabelValueLines(
    doc,
    invoiceMetadata,
    rightX + 10,
    contentTop,
    { labelWidth: 78, width: 195, lineGap },
  );

  const contentBottom = Math.max(recipientBottom, metadataBottom) - lineGap;
  const boxHeight = contentBottom - y + contentBottomPadding;

  drawBox(doc, leftX, y, 270, boxHeight);
  drawBox(doc, rightX, y, 215, boxHeight);

  return y + boxHeight;
}
