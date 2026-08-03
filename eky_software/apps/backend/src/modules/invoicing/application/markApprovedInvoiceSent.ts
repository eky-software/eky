import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { ApprovedInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { withCalculatedApprovedInvoiceVatBreakdown } from '../domain/invoiceViewTotals.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { DeliveredInvoiceArchiveQueueFailureReporter } from '../ports/deliveredInvoiceArchiveQueueFailureReporter.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../ports/deliveredInvoiceArchiveTaskSink.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceManualDeliveryFinalizer } from '../ports/invoiceManualDeliveryFinalizer.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { GenerateApprovedInvoicePdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import { queueDeliveredInvoiceArchiveTaskSafely } from './queueDeliveredInvoiceArchiveTaskSafely.js';

export interface MarkApprovedInvoiceSentInput {
  actorContext: ActorContext;
  deliveryMethod: 'manual' | 'print';
  invoiceId: string;
  markedSentAt: string;
}

export interface MarkApprovedInvoiceSentDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  deliveredInvoiceArchiveQueueFailureReporter: DeliveredInvoiceArchiveQueueFailureReporter;
  deliveredInvoiceArchiveTaskSink: DeliveredInvoiceArchiveTaskSink;
  ensureApprovedInvoicePdfDocument(
    input: GenerateApprovedInvoicePdfDocumentInput,
  ): Promise<ApprovedInvoiceDocumentMetadata>;
  invoiceDeliveryEventReader: InvoiceDeliveryEventReader;
  invoiceManualDeliveryFinalizer: InvoiceManualDeliveryFinalizer;
}

export async function markApprovedInvoiceSent(
  input: MarkApprovedInvoiceSentInput,
  dependencies: MarkApprovedInvoiceSentDependencies,
): Promise<ApprovedInvoiceView> {
  requirePermission(input.actorContext, 'sendInvoices');

  const actorUserId = requireIdentifier(input.actorContext.actorId, 'Actor user id');
  const companyId = requireIdentifier(input.actorContext.companyId, 'Company id');
  const invoiceId = requireIdentifier(input.invoiceId, 'Approved invoice id');
  const markedSentAt = requireIdentifier(input.markedSentAt, 'Sent timestamp');
  const currentInvoice =
    await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (currentInvoice === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  requireInvoiceDeliveryEligible(currentInvoice);

  if (currentInvoice.status === 'sent') {
    return withCalculatedApprovedInvoiceVatBreakdown(currentInvoice);
  }

  if (
    await dependencies.invoiceDeliveryEventReader.hasUnresolvedDeliveryEvent(
      companyId,
      invoiceId,
    )
  ) {
    throw new InvoiceDeliveryConflictError();
  }

  const document = await dependencies.ensureApprovedInvoicePdfDocument({
    companyId,
    createdAt: markedSentAt,
    invoiceId,
  });
  const deliveryEventId = randomUUID();

  const completion =
    await dependencies.invoiceManualDeliveryFinalizer.completeManualDelivery({
      actorUserId,
      auditEventId: randomUUID(),
      companyId,
      deliveredAt: markedSentAt,
      deliveryEventId,
      deliveryMethod: input.deliveryMethod,
      documentId: document.id,
      invoiceId,
    });

  if (completion === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  await queueDeliveredInvoiceArchiveTaskSafely(
    {
      createdAt: markedSentAt,
      deliveryEventId,
      document,
      invoice: currentInvoice,
    },
    dependencies.deliveredInvoiceArchiveTaskSink,
    dependencies.deliveredInvoiceArchiveQueueFailureReporter,
  );

  return withCalculatedApprovedInvoiceVatBreakdown({
    ...currentInvoice,
    status: 'sent',
    updatedAt: completion.updatedAt,
  });
}
