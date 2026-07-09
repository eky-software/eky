import { randomUUID } from 'node:crypto';

import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import {
  normalizeDeliveryBodyPreview,
  normalizeDeliveryCreatedBy,
  normalizeDeliveryEmail,
  normalizeDeliveryOptionalIdentifier,
  normalizeDeliveryProviderMessageId,
  normalizeDeliverySafeErrorMessage,
  normalizeDeliverySubject,
  normalizeDeliveryTechnicalErrorCode,
  requireInvoiceDeliveryMethod,
  requireInvoiceDeliveryProvider,
  requireInvoiceDeliveryStatus,
} from '../domain/invoiceDeliveryEventRules.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';

export interface RecordInvoiceDeliveryEventInput {
  companyId: string;
  invoiceId: string;
  documentId?: string | null;
  deliveryMethod: string;
  provider: string;
  status: string;
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
  invoiceDeliveryEventRepository: InvoiceDeliveryEventRepository;
}

export async function recordInvoiceDeliveryEvent(
  input: RecordInvoiceDeliveryEventInput,
  dependencies: RecordInvoiceDeliveryEventDependencies,
): Promise<InvoiceDeliveryEvent> {
  const event: InvoiceDeliveryEvent = {
    id: randomUUID(),
    companyId: requireIdentifier(input.companyId, 'Company id'),
    invoiceId: requireIdentifier(input.invoiceId, 'Approved invoice id'),
    documentId: normalizeDeliveryOptionalIdentifier(
      input.documentId,
      'Invoice document id',
    ),
    deliveryMethod: requireInvoiceDeliveryMethod(input.deliveryMethod),
    provider: requireInvoiceDeliveryProvider(input.provider),
    status: requireInvoiceDeliveryStatus(input.status),
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
