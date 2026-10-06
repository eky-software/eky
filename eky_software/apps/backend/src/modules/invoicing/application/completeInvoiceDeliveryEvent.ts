import {
  normalizeDeliveryProviderMessageId,
  normalizeDeliverySafeErrorMessage,
  normalizeDeliveryTechnicalErrorCode,
} from '../domain/invoiceDeliveryEventRules.js';
import type { OtherEmailCompletionInput, EmailCompletionResult } from '../domain/invoiceDeliveryReservation.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';

export async function completeInvoiceDeliveryEvent(
  input: OtherEmailCompletionInput,
  invoiceDeliveryEventRepository: InvoiceDeliveryEventRepository,
): Promise<EmailCompletionResult> {
  if (input.result.status === 'succeeded' && input.reservation.mode === 'smtpTest') {
    return invoiceDeliveryEventRepository.completeDeliveryEvent({
      reservation: input.reservation,
      result: { status: 'succeeded', providerMessageId: normalizeDeliveryProviderMessageId(input.result.providerMessageId) },
    });
  }
  if (input.result.status === 'succeeded') throw new Error('Customer success requires the invoice finalizer.');
  return invoiceDeliveryEventRepository.completeDeliveryEvent({
    reservation: input.reservation,
    result: {
      safeErrorMessage: normalizeDeliverySafeErrorMessage(
        input.result.safeErrorMessage,
      ),
      status: input.result.status,
      technicalErrorCode: normalizeDeliveryTechnicalErrorCode(
        input.result.technicalErrorCode,
      ),
    },
  });
}
