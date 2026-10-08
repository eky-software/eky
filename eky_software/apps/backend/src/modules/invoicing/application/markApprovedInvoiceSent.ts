import { randomUUID } from 'node:crypto';
import type { ActorContext } from '@eky/auth';
import { requirePermission } from '@eky/permissions';

import type { RevisionInvoiceDocumentMetadata } from '../domain/approvedInvoiceDocument.js';
import { toRevisionInvoiceDeliveryTarget } from './toRevisionInvoiceDeliveryTarget.js';
import { requireIdentifier } from '../domain/invoiceDraftRules.js';
import { withCalculatedApprovedInvoiceVatBreakdown } from '../domain/invoiceViewTotals.js';
import type { ApprovedInvoiceView } from '../domain/approvedInvoiceView.js';
import type { ApprovedInvoiceReader } from '../ports/approvedInvoiceReader.js';
import type { InvoiceContentRevisionReader } from '../ports/invoiceContentRevisionReader.js';
import type { InvoiceLegacyRevisionPromoter } from '../ports/invoiceLegacyRevisionPromoter.js';
import { prepareInvoiceDeliveryRevision } from './prepareInvoiceDeliveryRevision.js';
import type { DeliveredInvoiceArchiveQueueFailureReporter } from '../ports/deliveredInvoiceArchiveQueueFailureReporter.js';
import type { DeliveredInvoiceArchiveTaskSink } from '../ports/deliveredInvoiceArchiveTaskSink.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceManualDeliveryFinalizer } from '../ports/invoiceManualDeliveryFinalizer.js';
import { InvoiceDeliveryConflictError } from './invoiceDeliveryConflictError.js';
import { ApprovedInvoiceNotFoundError } from './approvedInvoiceNotFoundError.js';
import type { GenerateInvoiceRevisionPdfDocumentInput } from './generateApprovedInvoicePdfDocument.js';
import { requireInvoiceDeliveryEligible } from './requireInvoiceDeliveryEligible.js';
import { requireLegacyInvoiceDeliveryReviewed } from './requireLegacyInvoiceDeliveryReviewed.js';
import { queueDeliveredInvoiceArchiveTaskSafely } from './queueDeliveredInvoiceArchiveTaskSafely.js';

export interface MarkApprovedInvoiceSentInput {
  actorContext: ActorContext;
  deliveryMethod: 'manual' | 'print';
  invoiceId: string;
  markedSentAt: string;
}

export interface MarkApprovedInvoiceSentDependencies {
  approvedInvoiceReader: ApprovedInvoiceReader;
  invoiceContentRevisionReader: Pick<InvoiceContentRevisionReader, 'getCurrentRevision'>;
  deliveredInvoiceArchiveQueueFailureReporter: DeliveredInvoiceArchiveQueueFailureReporter;
  deliveredInvoiceArchiveTaskSink: DeliveredInvoiceArchiveTaskSink;
  invoiceLegacyRevisionPromoter: InvoiceLegacyRevisionPromoter;
  ensureInvoiceRevisionPdfDocument(
    input: GenerateInvoiceRevisionPdfDocumentInput,
  ): Promise<RevisionInvoiceDocumentMetadata>;
  invoiceDeliveryEventReader: Pick<InvoiceDeliveryEventReader, 'hasUnresolvedDeliveryEvent' | 'requiresLegacyDeliveryReview'>;
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
  const revision = await dependencies.invoiceContentRevisionReader.getCurrentRevision({ companyId, invoiceId });
  const currentInvoice =
    await dependencies.approvedInvoiceReader.getApprovedInvoiceById(
    companyId,
    invoiceId,
  );

  if (currentInvoice === undefined || revision === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  requireInvoiceDeliveryEligible(currentInvoice);
  await requireLegacyInvoiceDeliveryReviewed({ companyId, invoiceId }, dependencies.invoiceDeliveryEventReader);

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

  const key = await prepareInvoiceDeliveryRevision(revision, { companyId, invoiceId }, dependencies.invoiceLegacyRevisionPromoter);
  const document = await dependencies.ensureInvoiceRevisionPdfDocument({
    key,
    createdAt: markedSentAt,
  });
  const deliveryEventId = randomUUID();

  const completion =
    await dependencies.invoiceManualDeliveryFinalizer.completeManualDelivery({
      actorUserId,
      auditEventId: randomUUID(),
      target: toRevisionInvoiceDeliveryTarget(key, document),
      deliveredAt: markedSentAt,
      deliveryEventId,
      deliveryMethod: input.deliveryMethod,
    });

  if (completion === undefined) {
    throw new ApprovedInvoiceNotFoundError();
  }

  if (completion.outcome === 'completed') await queueDeliveredInvoiceArchiveTaskSafely(
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
