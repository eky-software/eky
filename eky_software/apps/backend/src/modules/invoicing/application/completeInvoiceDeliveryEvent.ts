import {
  normalizeDeliveryProviderMessageId,
  normalizeDeliverySafeErrorMessage,
  normalizeDeliveryTechnicalErrorCode,
  requireInvoiceDeliveryStatus,
} from '../domain/invoiceDeliveryEventRules.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';

export interface CompleteInvoiceDeliveryEventInput {
  companyId: string;
  eventId: string;
  providerMessageId?: string | null;
  safeErrorMessage?: string | null;
  status: 'succeeded' | 'failed' | 'outcomeUnknown';
  technicalErrorCode?: string | null;
}

export async function completeInvoiceDeliveryEvent(
  input: CompleteInvoiceDeliveryEventInput,
  invoiceDeliveryEventRepository: InvoiceDeliveryEventRepository,
): Promise<void> {
  const status = requireInvoiceDeliveryStatus(input.status);

  if (
    status !== 'succeeded' &&
    status !== 'failed' &&
    status !== 'outcomeUnknown'
  ) {
    throw new Error('Delivery event completion status is invalid.');
  }

  await invoiceDeliveryEventRepository.completeDeliveryEvent({
    companyId: requireIdentifier(input.companyId, 'Company id'),
    eventId: requireIdentifier(input.eventId, 'Delivery event id'),
    providerMessageId: normalizeDeliveryProviderMessageId(
      input.providerMessageId,
    ),
    safeErrorMessage: normalizeDeliverySafeErrorMessage(
      input.safeErrorMessage,
    ),
    status,
    technicalErrorCode: normalizeDeliveryTechnicalErrorCode(
      input.technicalErrorCode,
    ),
  });
}
