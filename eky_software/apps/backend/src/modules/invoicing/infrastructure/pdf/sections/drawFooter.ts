import type { ApprovedInvoiceView } from '../../../domain/approvedInvoiceView.js';
import { formatPdfIban } from '../approvedInvoicePdfFormatting.js';
import { invoicePdfLayout } from '../approvedInvoicePdfLayout.js';

export function drawFooter(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
): void {
  const y = invoicePdfLayout.footerTop + 4;
  const x = invoicePdfLayout.margin;

  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('Osoite', x, y, { width: 110 });
  doc.text('Puh, sähköposti', x + 130, y, { width: 110 });
  doc.text('Alv, Y-tunnus, kotip.', x + 260, y, { width: 110 });
  doc.text('Pankki', x + 390, y, { width: 120 });

  doc.font('Helvetica').fontSize(8);
  doc.text(
    [
      invoice.companyNameSnapshot,
      invoice.companyStreetAddressSnapshot,
      `${invoice.companyPostalCodeSnapshot} ${invoice.companyCitySnapshot}`.trim(),
    ].join('\n'),
    x,
    y + 18,
    { width: 110 },
  );
  doc.text(
    [
      invoice.companyPhoneSnapshot,
      invoice.companyEmailSnapshot,
      invoice.companyWebsiteSnapshot,
    ]
      .filter(Boolean)
      .join('\n'),
    x + 130,
    y + 18,
    { width: 110 },
  );
  doc.text(
    [
      invoice.companyVatNumberSnapshot
        ? `ALV ${invoice.companyVatNumberSnapshot}`
        : '',
      invoice.companyBusinessIdSnapshot
        ? `Y-tunnus ${invoice.companyBusinessIdSnapshot}`
        : '',
      invoice.companyCitySnapshot
        ? `Kotipaikka ${invoice.companyCitySnapshot}`
        : '',
    ]
      .filter(Boolean)
      .join('\n'),
    x + 260,
    y + 18,
    { width: 110 },
  );
  doc.text(
    [
      invoice.companyBankNameSnapshot,
      invoice.companyIbanSnapshot
        ? `IBAN ${formatPdfIban(invoice.companyIbanSnapshot)}`
        : '',
      invoice.companyBicSnapshot ? `BIC ${invoice.companyBicSnapshot}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    x + 390,
    y + 18,
    { width: 120 },
  );
}
