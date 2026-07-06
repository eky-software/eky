import PDFDocument from 'pdfkit';

import type {
  ApprovedInvoiceView,
  ApprovedInvoiceViewLine,
} from '../../domain/approvedInvoiceView.js';
import {
  formatPdfCents,
  formatPdfDate,
  formatPdfDiscount,
  formatPdfIban,
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

  drawPaymentBar(doc, invoice, Math.max(totalsBottom + 18, 628));
  drawFooter(doc, invoice);
  drawPageNumbers(doc);
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

function drawAdditionalDetails(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const lines = [
    { label: 'Toimitus / kohde', value: invoice.deliveryAddressText },
    { label: 'Lisätieto', value: invoice.note },
  ];
  const visibleLines = lines.filter((line) => line.value.trim().length > 0);

  if (visibleLines.length === 0) {
    return y;
  }

  const x = invoicePdfLayout.margin;
  const contentX = x + 10;
  const contentWidth = invoicePdfLayout.contentWidth - 20;
  const labelWidth = 88;
  const valueWidth = contentWidth - labelWidth;
  const contentHeight = visibleLines.reduce(
    (height, line) =>
      height +
      Math.max(
        12,
        doc.font('Helvetica-Bold').fontSize(8.5).heightOfString(line.label, {
          width: labelWidth,
        }),
        doc.font('Helvetica').fontSize(8.5).heightOfString(line.value, {
          width: valueWidth,
        }),
      ) +
      2,
    0,
  );
  const boxHeight = Math.max(32, contentHeight + 16);

  drawBox(doc, x, y, invoicePdfLayout.contentWidth, boxHeight);
  doc.fontSize(8.5);
  drawLabelValueLines(doc, visibleLines, contentX, y + 9, {
    labelWidth,
    width: contentWidth,
    lineGap: 2,
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

function drawVatAndTotals(
  doc: PDFKit.PDFDocument,
  invoice: ApprovedInvoiceView,
  y: number,
): number {
  const x = invoicePdfLayout.margin;
  const totalsX = 342;
  let currentY = y;

  doc.font('Helvetica-Bold').fontSize(10).text('ALV-erittely', x, currentY);
  currentY += 18;
  doc.font('Helvetica-Bold').fontSize(8);
  doc.text('ALV %', x, currentY, { width: 55 });
  doc.text('Veroton', x + 88, currentY, { width: 82, align: 'right' });
  doc.text('ALV', x + 208, currentY, { width: 82, align: 'right' });
  currentY += 14;
  doc.font('Helvetica').fontSize(8.5);

  for (const vat of invoice.vatBreakdown) {
    doc.text(formatPdfPercentBasisPoints(vat.vatRateBasisPoints), x, currentY, {
      width: 55,
    });
    doc.text(formatPdfCents(vat.netCents), x + 88, currentY, {
      width: 82,
      align: 'right',
    });
    doc.text(formatPdfCents(vat.vatCents), x + 208, currentY, {
      width: 82,
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
    totalsY + 32,
    true,
  );
  doc.font('Helvetica').fontSize(9);

  return Math.max(currentY, totalsY + 50);
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
  doc.text(label, x, y, { width: 118 });
  doc.text(value, x + 118, y, {
    width: 90,
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
  doc.font('Helvetica-Bold').fontSize(10);
  doc.text(`Viitenumero: ${invoice.referenceNumber}`, x, y + 12, {
    width: 160,
  });
  doc.text(`Eräpäivä: ${formatPdfDate(invoice.dueDate)}`, x + 174, y + 12, {
    width: 120,
  });
  doc.text(
    `Yhteensä: ${formatPdfCents(invoice.totals.grossTotalCents)}`,
    x + 312,
    y + 12,
    {
      width: 199,
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
    lineGap: 1,
  });
}

function drawPageNumbers(doc: PDFKit.PDFDocument): void {
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
