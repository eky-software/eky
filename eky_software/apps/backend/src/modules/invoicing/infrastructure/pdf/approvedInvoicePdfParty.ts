import type { ApprovedInvoiceView } from '../../domain/approvedInvoiceView.js';
import { drawLabelValueLines } from './approvedInvoicePdfLayout.js';

export interface PartySnapshot {
  name: string;
  businessId: string;
  customerNumber?: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  email: string;
  phone: string;
}

export function drawParty(
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

export function drawAddressLines(
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

export function getBillingRecipient(
  invoice: ApprovedInvoiceView,
): PartySnapshot {
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
