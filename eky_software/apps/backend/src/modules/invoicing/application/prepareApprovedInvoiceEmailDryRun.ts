import {
  createApprovedInvoiceEmailAttachmentPreview,
  type ApprovedInvoiceEmailPreview,
} from './approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type {
  GenerateApprovedInvoicePdfDocumentInput,
} from './generateApprovedInvoicePdfDocument.js';
import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { withCalculatedApprovedInvoiceVatBreakdown } from '../domain/invoiceViewTotals.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailDeliveryProvider } from '../ports/invoiceEmailDeliveryProvider.js';

export interface PrepareApprovedInvoiceEmailDryRunInput {
  companyId: string;
  invoiceId: string;
  preparedAt: string;
}

export interface PrepareApprovedInvoiceEmailDryRunDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  invoiceEmailDeliveryProvider: InvoiceEmailDeliveryProvider;
}

export async function prepareApprovedInvoiceEmailDryRun(
  input: PrepareApprovedInvoiceEmailDryRunInput,
  dependencies: PrepareApprovedInvoiceEmailDryRunDependencies,
): Promise<ApprovedInvoiceEmailPreview> {
  const companyId = requireIdentifier(input.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const preparedAt = requireIdentifier(input.preparedAt, 'Email timestamp');

  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  const invoiceForEmail = withCalculatedApprovedInvoiceVatBreakdown(invoice);
  const document = await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: preparedAt,
    invoiceId,
  });
  const email = createApprovedInvoiceEmailPreview(invoiceForEmail, document);

  return dependencies.invoiceEmailDeliveryProvider.prepareDryRunEmail(email);
}

function createApprovedInvoiceEmailPreview(
  invoice: ApprovedInvoiceView,
  document: ApprovedInvoiceDocumentMetadata,
): ApprovedInvoiceEmailPreview {
  return {
    attachment: createApprovedInvoiceEmailAttachmentPreview(document),
    body: createEmailBody(invoice),
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    provider: 'dryRun',
    subject: `Lasku ${invoice.invoiceNumber}`,
    to: getDefaultRecipientEmail(invoice),
  };
}

function getDefaultRecipientEmail(invoice: ApprovedInvoiceView): string {
  const billingRecipientEmail = invoice.billingRecipientEmailSnapshot.trim();

  if (billingRecipientEmail.length > 0) {
    return billingRecipientEmail;
  }

  return invoice.customerEmailSnapshot.trim();
}

function createEmailBody(invoice: ApprovedInvoiceView): string {
  const senderName = invoice.companyNameSnapshot.trim();
  const dueDate = formatFinnishDate(invoice.dueDate);
  const grossTotal = formatCentsAsEuro(invoice.totals.grossTotalCents);
  const iban = formatIban(invoice.companyIbanSnapshot);
  const ibanLine = iban.length > 0 ? [`Tilinumero: ${iban}`] : [];

  return [
    'Hei,',
    '',
    `Liitteenä lasku ${invoice.invoiceNumber}.`,
    `Eräpäivä: ${dueDate}`,
    `Viitenumero: ${invoice.referenceNumber}`,
    ...ibanLine,
    `Summa: ${grossTotal}`,
    '',
    'Ystävällisin terveisin',
    senderName.length > 0 ? senderName : 'Eky',
  ].join('\n');
}

function formatFinnishDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);

  if (match === null) {
    return value;
  }

  return `${match[3]}.${match[2]}.${match[1]}`;
}

function formatCentsAsEuro(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absoluteCents = Math.abs(cents);
  const euros = Math.trunc(absoluteCents / 100);
  const centsPart = `${absoluteCents % 100}`.padStart(2, '0');

  return `${sign}${formatIntegerWithSpaces(euros)},${centsPart} EUR`;
}

function formatIntegerWithSpaces(value: number): string {
  return value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatIban(value: string): string {
  const normalizedIban = value.replace(/\s+/g, '').toUpperCase();

  return normalizedIban.replace(/(.{4})(?=.)/g, '$1 ').trim();
}
