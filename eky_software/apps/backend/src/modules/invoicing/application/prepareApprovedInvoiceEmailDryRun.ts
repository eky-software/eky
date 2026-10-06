import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import {
  createApprovedInvoiceEmailAttachmentPreview,
  type ApprovedInvoiceEmailDocumentTarget,
  type ApprovedInvoiceEmailPreview,
} from './approvedInvoiceEmailPreview.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import { requireLegacyInvoiceDeliveryReviewed, type InvoiceLegacyDeliveryReviewReader } from './requireLegacyInvoiceDeliveryReviewed.js';
import type {
  GenerateInvoiceRevisionPdfDocumentInput,
} from './generateApprovedInvoicePdfDocument.js';
import type { ApprovedInvoiceDocumentMetadata, PreservedLegacyInvoiceDocumentMetadata, RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { InvoiceDocumentIntegrityError } from './invoiceDocumentIntegrityError.js';
import { toRevisionInvoiceDeliveryTarget } from './toRevisionInvoiceDeliveryTarget.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';
import { prepareInvoiceDeliveryRevision } from './prepareInvoiceDeliveryRevision.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { withCalculatedApprovedInvoiceVatBreakdown } from '../domain/invoiceViewTotals.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceEmailDeliveryProvider } from '../ports/invoiceEmailDeliveryProvider.js';

export interface PrepareApprovedInvoiceEmailDryRunInput {
  actorContext: ActorContext;
  invoiceId: string;
  preparedAt: string;
}

export interface PrepareApprovedInvoiceEmailDryRunDependencies {
  invoiceDeliveryEventReader: InvoiceLegacyDeliveryReviewReader;
  approvedInvoiceReader: ApprovedInvoiceReader;
  invoiceContentRevisionReader: Pick<InvoiceContentRevisionReader, 'getCurrentRevision'>;
  invoiceLegacyRevisionPromoter: InvoiceLegacyRevisionPromoter;
  ensureInvoiceRevisionPdfDocument(
    input: GenerateInvoiceRevisionPdfDocumentInput,
  ): Promise<RevisionInvoiceDocumentMetadata>;
  preparePreservedLegacyInvoiceDocument(input: {
    actorContext: ActorContext; invoiceId: string; createdAt: string;
  }): Promise<PreservedLegacyInvoiceDocumentMetadata>;
  invoiceEmailDeliveryProvider: InvoiceEmailDeliveryProvider;
}

export async function prepareApprovedInvoiceEmailDryRun(
  input: PrepareApprovedInvoiceEmailDryRunInput,
  dependencies: PrepareApprovedInvoiceEmailDryRunDependencies,
): Promise<ApprovedInvoiceEmailPreview> {
  requirePermission(input.actorContext, 'sendInvoices');

  const companyId = requireIdentifier(
    input.actorContext.companyId,
    'Company id',
  );
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const preparedAt = requireIdentifier(input.preparedAt, 'Email timestamp');
  const revision = await dependencies.invoiceContentRevisionReader.getCurrentRevision({ companyId, invoiceId });

  const invoice = await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (invoice === undefined || revision === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  requireInvoiceDeliveryEligible(invoice);
  await requireLegacyInvoiceDeliveryReviewed({ companyId, invoiceId }, dependencies.invoiceDeliveryEventReader);

  if (revision.origin === 'legacySnapshot' && invoice.status === 'sent') {
    const document = await dependencies.preparePreservedLegacyInvoiceDocument({
      actorContext: input.actorContext, invoiceId, createdAt: preparedAt,
    });
    if (document.companyId !== companyId || document.invoiceId !== invoiceId
      || document.binding.kind !== 'preservedLegacy') throw new InvoiceDocumentIntegrityError();
    const email = createApprovedInvoiceEmailPreview(invoice, document, {
      kind: 'preservedLegacy', documentId: document.id,
    });
    return dependencies.invoiceEmailDeliveryProvider.prepareDryRunEmail(email);
  }

  const key = await prepareInvoiceDeliveryRevision(revision, { companyId, invoiceId }, dependencies.invoiceLegacyRevisionPromoter);
  const invoiceForEmail = withCalculatedApprovedInvoiceVatBreakdown(invoice);
  const document = await dependencies.ensureInvoiceRevisionPdfDocument({
    key,
    createdAt: preparedAt,
  });
  toRevisionInvoiceDeliveryTarget(key, document);
  const email = createApprovedInvoiceEmailPreview(invoiceForEmail, document, {
    kind: 'revision', documentId: document.id,
  });

  return dependencies.invoiceEmailDeliveryProvider.prepareDryRunEmail(email);
}

function createApprovedInvoiceEmailPreview(
  invoice: ApprovedInvoiceView,
  document: ApprovedInvoiceDocumentMetadata,
  documentTarget: ApprovedInvoiceEmailDocumentTarget,
): ApprovedInvoiceEmailPreview {
  return {
    attachment: createApprovedInvoiceEmailAttachmentPreview(document),
    body: documentTarget.kind === 'preservedLegacy'
      ? createPreservedLegacyEmailBody(invoice) : createEmailBody(invoice),
    documentTarget,
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    provider: 'dryRun',
    subject: `${
      invoice.invoiceKind === 'credit' ? 'Hyvityslasku' : 'Lasku'
    } ${invoice.invoiceNumber}`,
    to: getDefaultRecipientEmail(invoice),
  };
}

function createPreservedLegacyEmailBody(invoice: ApprovedInvoiceView): string {
  const label = invoice.invoiceKind === 'credit' ? 'hyvityslaskun' : 'laskun';
  return [
    'Hei,', '',
    `Liitteenä ${label} ${invoice.invoiceNumber} säilytetty PDF.`, '',
    'Ystävällisin terveisin', invoice.companyNameSnapshot.trim() || 'Eky',
  ].join('\n');
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
  const payeeName = senderName.length > 0 ? senderName : 'Eky';
  if (invoice.invoiceKind === 'credit') {
    return createCreditInvoiceEmailBody(invoice, payeeName);
  }

  const dueDate = formatFinnishDate(invoice.dueDate);
  const grossTotal = formatCentsAsEuro(invoice.totals.grossTotalCents);
  const iban = formatIban(invoice.companyIbanSnapshot);
  const ibanLine = iban.length > 0 ? [`Tilinumero: ${iban}`] : [];

  return [
    'Hei,',
    '',
    `Liitteenä lasku ${invoice.invoiceNumber}.`,
    `Eräpäivä: ${dueDate}`,
    `Maksun saaja: ${payeeName}`,
    `Viitenumero: ${invoice.referenceNumber}`,
    ...ibanLine,
    `Summa: ${grossTotal}`,
    '',
    'Ystävällisin terveisin',
    payeeName,
  ].join('\n');
}

function createCreditInvoiceEmailBody(
  invoice: ApprovedInvoiceView,
  senderName: string,
): string {
  const creditedInvoiceLine =
    invoice.creditedInvoiceNumber === null
      ? []
      : [
          `Hyvityslasku kohdistuu laskuun ${invoice.creditedInvoiceNumber}${
            invoice.creditedInvoiceDate === null
              ? ''
              : ` (${formatFinnishDate(invoice.creditedInvoiceDate)})`
          }.`,
        ];

  return [
    'Hei,',
    '',
    `Liitteenä hyvityslasku ${invoice.invoiceNumber}.`,
    ...creditedInvoiceLine,
    `Hyvityksen summa: ${formatCentsAsEuro(
      -Math.abs(invoice.totals.grossTotalCents),
    )}`,
    '',
    'Ystävällisin terveisin',
    senderName,
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
