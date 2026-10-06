import { randomUUID } from 'node:crypto';

import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import type { RevisionInvoiceDeliveryTarget } from '../domain/invoiceDeliveryReservation.js';
import {
  normalizeDeliveryBodyPreview,
  normalizeDeliveryCreatedBy,
  normalizeDeliveryEmail,
  normalizeDeliveryProviderMessageId,
  normalizeDeliverySafeErrorMessage,
  normalizeDeliverySubject,
  normalizeDeliveryTechnicalErrorCode,
  requireInvoiceDeliveryMethod,
  requireInvoiceDeliveryProvider,
  requireInvoiceDeliveryStatus,
  InvoiceDeliveryEventValidationError,
} from '../domain/invoiceDeliveryEventRules.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';

export interface RecordInvoiceDeliveryEventInput {
  id?: string;
  target: RevisionInvoiceDeliveryTarget;
  deliveryMethod: 'email';
  provider: 'dryRun';
  status: 'succeeded' | 'failed';
  recipientEmail?: string;
  ccEmail?: string;
  subject?: string;
  body?: string;
  bodyPreview?: string;
  providerMessageId?: string | null;
  safeErrorMessage?: string | null;
  technicalErrorCode?: string | null;
  createdAt: string;
  createdBy?: string;
}

export interface RecordInvoiceDeliveryEventDependencies {
  invoiceDeliveryEventRepository: Pick<InvoiceDeliveryEventRepository, 'saveDeliveryEvent'>;
}

export async function recordInvoiceDeliveryEvent(
  input: RecordInvoiceDeliveryEventInput,
  dependencies: RecordInvoiceDeliveryEventDependencies,
): Promise<InvoiceDeliveryEvent> {
  const deliveryMethod = requireInvoiceDeliveryMethod(input.deliveryMethod);
  const provider = requireInvoiceDeliveryProvider(input.provider);
  const status = requireInvoiceDeliveryStatus(input.status);
  if (deliveryMethod !== 'email' || provider !== 'dryRun'
    || (status !== 'succeeded' && status !== 'failed') || input.target?.kind !== 'revision') {
    throw new InvoiceDeliveryEventValidationError('Only revision-bound dry-run results can be recorded.');
  }
  const target: RevisionInvoiceDeliveryTarget = {
    ...input.target,
    companyId: requireIdentifier(input.target.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.target.invoiceId, 'Approved invoice id'),
    documentId: requireIdentifier(input.target.documentId, 'Invoice document id'),
    revisionId: requireIdentifier(input.target.revisionId, 'Invoice revision id'),
  };
  const event: InvoiceDryRunDeliveryEvent = {
    id:
      input.id === undefined
        ? randomUUID()
        : requireIdentifier(input.id, 'Delivery event id'),
    companyId: target.companyId,
    invoiceId: target.invoiceId,
    documentId: target.documentId,
    target,
    deliveryMethod,
    provider,
    status,
    recipientEmail: normalizeDeliveryEmail(input.recipientEmail),
    ccEmail: normalizeDeliveryEmail(input.ccEmail),
    subject: normalizeDeliverySubject(input.subject),
    bodyPreview: normalizeDeliveryBodyPreview(
      input.bodyPreview ?? input.body,
    ),
    providerMessageId: normalizeDeliveryProviderMessageId(
      input.providerMessageId,
    ),
    safeErrorMessage: normalizeDeliverySafeErrorMessage(
      input.safeErrorMessage,
    ),
    technicalErrorCode: normalizeDeliveryTechnicalErrorCode(
      input.technicalErrorCode,
    ),
    createdAt: requireIdentifier(input.createdAt, 'Delivery event timestamp'),
    createdBy: normalizeDeliveryCreatedBy(input.createdBy),
  };

  return dependencies.invoiceDeliveryEventRepository.saveDeliveryEvent(event);
}
