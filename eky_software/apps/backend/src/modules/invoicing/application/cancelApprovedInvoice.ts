import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { normalizeInvoiceCancellationReason } from '../domain/invoiceCancellation.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type {
  CancelledApprovedInvoiceResult,
  InvoiceCorrectionRepository,
} from '../ports/invoiceCorrectionRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import { InvoiceCancellationConflictError } from './invoiceCancellationConflictError.js';
import { InvoiceCancellationConfirmationError } from './invoiceCancellationConfirmationError.js';

export interface CancelApprovedInvoiceInput {
  actorContext: ActorContext;
  cancellationReason: string;
  cancelledAt: string;
  confirmationInvoiceNumber: string;
  invoiceId: string;
}

export interface CancelApprovedInvoiceDependencies {
  invoiceCorrectionRepository: InvoiceCorrectionRepository;
}

export async function cancelApprovedInvoice(
  input: CancelApprovedInvoiceInput,
  dependencies: CancelApprovedInvoiceDependencies,
): Promise<CancelledApprovedInvoiceResult> {
  requirePermission(input.actorContext, 'manageInvoiceCorrections');

  const actorUserId = requireIdentifier(input.actorContext.actorId, 'Actor user id');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const cancelledAt = requireIdentifier(input.cancelledAt, 'Cancellation timestamp');
  const confirmationInvoiceNumber = requireIdentifier(
    input.confirmationInvoiceNumber,
    'Invoice number confirmation',
  );
  const cancellationReason = normalizeInvoiceCancellationReason(
    input.cancellationReason,
  );

  const result =
    await dependencies.invoiceCorrectionRepository.cancelApprovedInvoice({
      actorUserId,
      auditEventId: randomUUID(),
      cancellationReason,
      cancelledAt,
      companyId,
      confirmationInvoiceNumber,
      invoiceId,
    });

  switch (result.outcome) {
    case 'cancelled':
      return result.invoice;
    case 'confirmationMismatch':
      throw new InvoiceCancellationConfirmationError();
    case 'deliveryConflict':
    case 'notCancellable':
      throw new InvoiceCancellationConflictError();
    case 'notFound':
      throw new ApprovedInvoiceNotFoundError();
  }
}
