import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import type { InvoicePaymentSummary } from '../domain/invoicePayment.js';
import type { InvoicePaymentRepository } from '../ports/invoicePaymentRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { InvoicePaymentClock } from './invoicePaymentClock.js';
import { InvoicePaymentConflictError } from './invoicePaymentConflictError.js';

export interface RevertInvoicePaidMarkInput {
  actorContext: ActorContext;
  invoiceId: string;
}

export interface RevertInvoicePaidMarkDependencies {
  clock: InvoicePaymentClock;
  invoicePaymentRepository: InvoicePaymentRepository;
}

export async function revertInvoicePaidMark(
  input: RevertInvoicePaidMarkInput,
  dependencies: RevertInvoicePaidMarkDependencies,
): Promise<InvoicePaymentSummary> {
  requirePermission(input.actorContext, 'manageInvoicePayments');

  const result =
    await dependencies.invoicePaymentRepository.revertInvoicePaidMark({
      actorUserId: requireIdentifier(input.actorContext.actorId, 'Actor user id'),
      companyId: requireIdentifier(input.actorContext.companyId, 'Company id'),
      eventId: randomUUID(),
      invoiceId: requireIdentifier(input.invoiceId, 'Approved invoice id'),
      recordedAt: dependencies.clock.now().toISOString(),
    });

  switch (result.outcome) {
    case 'idempotent':
    case 'reverted':
      return result.payment;
    case 'conflict':
      throw new InvoicePaymentConflictError();
    case 'notFound':
      throw new ApprovedInvoiceNotFoundError();
  }
}
