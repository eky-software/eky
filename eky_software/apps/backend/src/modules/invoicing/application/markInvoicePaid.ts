import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { requireInvoicePaymentDate } from '../domain/invoicePaymentDate.js';
import type { InvoicePaymentSummary } from '../domain/invoicePayment.js';
import type { InvoicePaymentRepository } from '../ports/invoicePaymentRepository.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import {
  getHelsinkiCalendarDate,
  type InvoicePaymentClock,
} from './invoicePaymentClock.js';
import { InvoicePaymentConflictError } from './invoicePaymentConflictError.js';
import { InvoicePaymentDateError } from './invoicePaymentDateError.js';

export interface MarkInvoicePaidInput {
  actorContext: ActorContext;
  invoiceId: string;
  paidOn: unknown;
}

export interface MarkInvoicePaidDependencies {
  clock: InvoicePaymentClock;
  invoicePaymentRepository: InvoicePaymentRepository;
}

export async function markInvoicePaid(
  input: MarkInvoicePaidInput,
  dependencies: MarkInvoicePaidDependencies,
): Promise<InvoicePaymentSummary> {
  requirePermission(input.actorContext, 'manageInvoicePayments');

  const actorUserId = requireIdentifier(input.actorContext.actorId, 'Actor user id');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const paidOn = requireInvoicePaymentDate(input.paidOn);
  const now = dependencies.clock.now();

  if (paidOn > getHelsinkiCalendarDate(now)) {
    throw new InvoicePaymentDateError();
  }

  const result = await dependencies.invoicePaymentRepository.markInvoicePaid({
    actorUserId,
    companyId,
    eventId: randomUUID(),
    invoiceId,
    paidOn,
    recordedAt: now.toISOString(),
  });

  switch (result.outcome) {
    case 'idempotent':
    case 'markedPaid':
      return result.payment;
    case 'conflict':
    case 'notPayable':
      throw new InvoicePaymentConflictError();
    case 'notFound':
      throw new ApprovedInvoiceNotFoundError();
  }
}
