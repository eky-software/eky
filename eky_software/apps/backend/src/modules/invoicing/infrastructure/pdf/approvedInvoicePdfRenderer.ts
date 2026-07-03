import PDFDocument from 'pdfkit';

import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDate,
  formatPdfDiscount,
  formatPdfPercentBasisPoints,
  formatPdfQuantity,
} from './approvedInvoicePdfFormatting.js';
import {
  drawBox,
  drawHorizontalLine,
  drawLabelValueLines,
  drawSectionTitle,
  invoicePdfLayout,
} from './approvedInvoicePdfLayout.js';

interface PartySnapshot {
  name: string;
  businessId: string;
  customerNumber?: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
}

export async function renderApprovedInvoicePdf(
  invoice: ApprovedInvoiceView,
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: invoicePdfLayout.margin,
      autoFirstPage: true,
      bufferPages: false,
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
  const deliveryBottom = drawDeliveryDetails(doc, invoice, metaBottom + 14);
  const linesBottom = drawInvoiceLines(doc, invoice, deliveryBottom + 18);
  const totalsBottom = drawVatAndTotals(doc, invoice, linesBottom + 18);

  drawPaymentBar(doc, invoice, Math.max(totalsBottom + 18, 628));
  drawFooter(doc, invoice);
}

function drawHeader(
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

function drawRecipientAndMeta(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const recipient = getBillingRecipient(invoice);
  const leftX = invoicePdfLayout.margin;
  const rightX = 338;
  const boxHeight = 178;

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
    { labelWidth: 78, width: 195, lineGap: 2 },
  );

  return y + boxHeight;
}

function drawDeliveryDetails(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  if (invoice.deliveryAddressText.trim().length === 0) {
    return y;
  }

  const x = invoicePdfLayout.margin;
  const contentX = x + 10;
  const contentWidth = invoicePdfLayout.contentWidth - 20;
  const titleHeight = 14;
  const valueHeight = doc.font('Helvetica').fontSize(9).heightOfString(
    invoice.deliveryAddressText,
    {
      width: contentWidth,
    },
  );
  const boxHeight = Math.max(52, titleHeight + valueHeight + 26);

  drawBox(doc, x, y, invoicePdfLayout.contentWidth, boxHeight);
  drawSectionTitle(doc, 'Toimitus / kohde', contentX, y + 10, contentWidth);
  doc
    .font('Helvetica')
    .fontSize(9)
    .fillColor('#000000')
    .text(invoice.deliveryAddressText, contentX, y + 30, {
      width: contentWidth,
    });

  return y + boxHeight;
}

function drawInvoiceLines(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const x = invoicePdfLayout.margin;
  const columns = createInvoiceLineColumns(x, invoice.priceInputMode);
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

  for (const line of invoice.lines) {
    const rowHeight = calculateLineHeight(doc, line);

    if (currentY + rowHeight > invoicePdfLayout.footerTop - 20) {
      doc.addPage();
      currentY = invoicePdfLayout.margin;
    }

    drawLineRow(doc, line, columns, currentY, invoice.priceInputMode);
    currentY += rowHeight;
  }

  drawHorizontalLine(doc, currentY - 2);

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

function drawVatAndTotals(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const x = invoicePdfLayout.margin;
  const totalsX = 360;
  let currentY = y;

  doc.font('Helvetica-Bold').fontSize(10).text('ALV-erittely', x, currentY);
  currentY += 18;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('ALV %', x, currentY, { width: 55 });
  doc.text('Veroton', x + 102, currentY, { width: 78, align: 'right' });
  doc.text('ALV', x + 218, currentY, { width: 78, align: 'right' });
  currentY += 14;
  doc.font('Helvetica').fontSize(8.5);

  for (const vat of invoice.vatBreakdown) {
    doc.text(formatPdfPercentBasisPoints(vat.vatRateBasisPoints), x, currentY, {
      width: 55,
    });
    doc.text(formatPdfCents(vat.netCents), x + 102, currentY, {
      width: 78,
      align: 'right',
    });
    doc.text(formatPdfCents(vat.vatCents), x + 218, currentY, {
      width: 78,
      align: 'right',
    });
    currentY += 14;
  }

  const totalsY = y;
  drawTotalsLine(
    doc,
    'Yhteensä ilman alv',
    formatPdfCents(invoice.totals.netTotalCents),
    totalsX,
    totalsY,
  );
  drawTotalsLine(
    doc,
    'Alv yhteensä',
    formatPdfCents(invoice.totals.vatTotalCents),
    totalsX,
    totalsY + 18,
  );
  drawTotalsLine(
    doc,
    'Loppusumma EUR',
    formatPdfCents(invoice.totals.grossTotalCents),
    totalsX,
    totalsY + 42,
    true,
  );
  doc.font('Helvetica').fontSize(9);

  return Math.max(currentY, totalsY + 60);
}

function drawTotalsLine(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  strong = false,
): void {
  doc.font(strong ? 'Helvetica-Bold' : 'Helvetica').fontSize(strong ? 10 : 9);
  doc.text(label, x, y, { width: 112 });
  doc.text(value, x + 112, y, {
    width: 80,
    align: 'right',
  });
}

function drawPaymentBar(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): void {
  const x = invoicePdfLayout.margin;
  drawHorizontalLine(doc, y);
  doc.font('Helvetica-Bold').fontSize(11);
  doc.text(`Viitenumero: ${invoice.referenceNumber}`, x, y + 12, {
    width: 170,
  });
  doc.text(`Eräpäivä: ${formatPdfDate(invoice.dueDate)}`, x + 205, y + 12, {
    width: 140,
  });
  doc.text(
    `Yhteensä: ${formatPdfCents(invoice.totals.grossTotalCents)}`,
    x + 360,
    y + 12,
    {
      width: 150,
      align: 'right',
    },
  );
  drawHorizontalLine(doc, y + 38);
  doc.font('Helvetica').fontSize(9);
}

function drawFooter(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
): void {
  const y = invoicePdfLayout.footerTop + 4;
  const x = invoicePdfLayout.margin;

  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('Osoite', x, y, { width: 110 });
  doc.text('Puh, internet', x + 130, y, { width: 110 });
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
    [invoice.companyPhoneSnapshot, invoice.companyEmailSnapshot]
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
      invoice.companyIbanSnapshot ? `IBAN ${invoice.companyIbanSnapshot}` : '',
      invoice.companyBicSnapshot ? `BIC ${invoice.companyBicSnapshot}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    x + 390,
    y + 18,
    { width: 120 },
  );
}

function drawParty(
  doc: PDFKit.PDFDocument,
  party: PartySnapshot,
  x: number,
  y: number,
  width: number,
): void {
  const lines = [
    { label: 'Nimi', value: party.name },
    { label: 'Asiakasnumero', value: party.customerNumber ?? '' },
    { label: 'Y-tunnus', value: party.businessId },
    { label: 'Osoite', value: party.streetAddress },
    {
      label: 'Postinumero',
      value: `${party.postalCode} ${party.city}`.trim(),
    },
    { label: 'Sähköposti', value: party.email },
    { label: 'Puhelin', value: party.phone },
  ];

  drawLabelValueLines(doc, lines, x, y, {
    labelWidth: 82,
    width,
    lineGap: 2,
  });
}

function drawAddressLines(
  doc: PDFKit.PDFDocument,
  party: PartySnapshot,
  x: number,
  y: number,
  width: number,
): void {
  doc
    .font('Helvetica')
    .fontSize(9)
    .text(
      [
        party.streetAddress,
        `${party.postalCode} ${party.city}`.trim(),
        party.email,
        party.phone,
      ]
        .filter(Boolean)
        .join('\n'),
      x,
      y,
      { width },
    );
}

function getBillingRecipient(invoice: ApprovedInvoiceView): PartySnapshot {
  if (invoice.billingRecipientCustomerId) {
    return {
      name: invoice.billingRecipientNameSnapshot,
      customerNumber: invoice.billingRecipientCustomerNumberSnapshot,
      businessId: invoice.billingRecipientBusinessIdSnapshot,
      streetAddress: invoice.billingRecipientStreetAddressSnapshot,
      postalCode: invoice.billingRecipientPostalCodeSnapshot,
      city: invoice.billingRecipientCitySnapshot,
      email: invoice.billingRecipientEmailSnapshot,
      phone: invoice.billingRecipientPhoneSnapshot,
    };
  }

  return {
    name: invoice.customerNameSnapshot,
    customerNumber: invoice.customerNumberSnapshot,
    businessId: invoice.customerBusinessIdSnapshot,
    streetAddress: invoice.customerStreetAddressSnapshot,
    postalCode: invoice.customerPostalCodeSnapshot,
    city: invoice.customerCitySnapshot,
    email: invoice.customerEmailSnapshot,
    phone: invoice.customerPhoneSnapshot,
  };
}

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
      label: priceInputMode === 'gross' ? 'Yht. sis. alv' : 'Yht. alv 0',
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
