import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDryRunDeliveryEvent } from '../domain/invoiceRecordedDeliveryEvent.js';
import { assertInvoiceDeliveryTarget, hasBlockingDeliveryHistory, readDeliveryTarget, readEligibleDeliveryInvoice } from './invoiceDeliveryReservationPersistence.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceDeliveryEventRepository, ReserveEmailDeliveryInput, ReserveEmailDeliveryResult } from '../ports/invoiceDeliveryEventRepository.js';
import type { CustomerEmailCompletionInput, OtherEmailCompletionInput, EmailCompletionResult } from '../domain/invoiceDeliveryReservation.js';
import type { InvoiceEmailDeliveryFinalizer } from '../ports/invoiceEmailDeliveryFinalizer.js';
import type {
  CompleteManualInvoiceDeliveryInput,
  CompleteManualInvoiceDeliveryResult,
  InvoiceManualDeliveryFinalizer,
} from '../ports/invoiceManualDeliveryFinalizer.js';
import { SqliteInvoiceDeliveryEventQueries } from './sqliteInvoiceDeliveryEventQueries.js';
import { SqliteInvoiceDeliveryEventStatements } from './sqliteInvoiceDeliveryEventStatements.js';
import type { InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceEventDocument } from '../ports/invoiceDeliveryEventReader.js';
import { readInvoiceEventDocument } from './readInvoiceEventDocument.js';
import { reserveInvoiceEmailDelivery } from './reserveInvoiceEmailDelivery.js';
import { completeReservedInvoiceEmailDelivery } from './completeReservedInvoiceEmailDelivery.js';
import { requiresLegacyInvoiceDeliveryReview } from './requiresLegacyInvoiceDeliveryReview.js';

export { toInvoiceDeliveryEvent } from './invoiceDeliveryEventPersistenceRows.js';

export class SqliteInvoiceDeliveryEventRepository
  implements
    InvoiceDeliveryEventRepository,
    InvoiceDeliveryEventReader,
    InvoiceEmailDeliveryFinalizer,
    InvoiceManualDeliveryFinalizer
{
  private readonly queries: SqliteInvoiceDeliveryEventQueries;
  private readonly statements: SqliteInvoiceDeliveryEventStatements;

  constructor(private readonly database: DatabaseConnection) {
    this.queries = new SqliteInvoiceDeliveryEventQueries(database);
    this.statements = new SqliteInvoiceDeliveryEventStatements(database);
  }

  async completeSuccessfulEmailDelivery(
    input: CustomerEmailCompletionInput,
  ): Promise<EmailCompletionResult> {
    return completeReservedInvoiceEmailDelivery(this.database, input, true);
  }

  async reserveEmailDelivery(input: ReserveEmailDeliveryInput): Promise<ReserveEmailDeliveryResult> {
    return reserveInvoiceEmailDelivery(this.database, input);
  }

  async completeDeliveryEvent(
    input: OtherEmailCompletionInput,
  ): Promise<EmailCompletionResult> {
    return completeReservedInvoiceEmailDelivery(this.database, input, false);
  }

  async completeManualDelivery(
    input: CompleteManualInvoiceDeliveryInput,
  ): Promise<CompleteManualInvoiceDeliveryResult | undefined> {
    const completeTransaction = this.database.transaction(() =>
      this.completeManualDeliveryWithinTransaction(input),
    );

    return completeTransaction.immediate();
  }

  async hasUnresolvedDeliveryEvent(
    companyId: string,
    invoiceId: string,
  ): Promise<boolean> {
    return this.queries.hasUnresolvedDeliveryEvent(companyId, invoiceId);
  }

  async requiresLegacyDeliveryReview(scope: InvoiceScope): Promise<boolean> {
    return requiresLegacyInvoiceDeliveryReview(this.database, scope);
  }

  async hasInvoiceIdentity(scope: InvoiceScope): Promise<boolean> {
    return this.database.prepare<[string, string], { id: string }>(`
      SELECT id FROM invoices WHERE company_id = ? AND id = ?
    `).get(scope.companyId, scope.invoiceId) !== undefined;
  }

  async findEventDocument(scope: InvoiceScope, eventId: string): Promise<InvoiceEventDocument | undefined> {
    return readInvoiceEventDocument(this.database, scope, eventId);
  }

  async listDeliveryEvents(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoiceDeliveryEventSummary[]> {
    return this.queries.listDeliveryEvents(companyId, invoiceId);
  }

  async saveDeliveryEvent(
    event: InvoiceDryRunDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
    if (event.provider !== 'dryRun' || event.deliveryMethod !== 'email'
      || (event.status !== 'succeeded' && event.status !== 'failed')) throw new InvoiceDeliveryConflictError();
    assertInvoiceDeliveryTarget(event.target);
    if (event.target.kind !== 'revision' || event.companyId !== event.target.companyId
      || event.invoiceId !== event.target.invoiceId || event.documentId !== event.target.documentId) {
      throw new InvoiceDeliveryConflictError();
    }
    this.database.transaction(() => {
      if (readEligibleDeliveryInvoice(this.database, event.target) === undefined
        || !readDeliveryTarget(this.database, event.target)) throw new InvoiceDeliveryConflictError();
      this.statements.insertDeliveryEvent(event);
    }).immediate();

    return event;
  }

  private completeManualDeliveryWithinTransaction(
    input: CompleteManualInvoiceDeliveryInput,
  ): CompleteManualInvoiceDeliveryResult | undefined {
    const target = input.target;
    assertInvoiceDeliveryTarget(target);
    if (target.kind !== 'revision' || (input.deliveryMethod !== 'manual' && input.deliveryMethod !== 'print')) {
      throw new InvoiceDeliveryConflictError();
    }
    const invoice = this.queries.getManualDeliveryInvoice(
      target.companyId,
      target.invoiceId,
    );

    if (invoice === undefined) {
      return undefined;
    }

    if (readEligibleDeliveryInvoice(this.database, target) === undefined
      || !readDeliveryTarget(this.database, target)) throw new InvoiceDeliveryConflictError();

    if (invoice.status === 'sent') {
      return { outcome: 'alreadySent', updatedAt: invoice.updated_at };
    }

    if (hasBlockingDeliveryHistory(this.database, target)) {
      throw new InvoiceDeliveryConflictError();
    }

    this.statements.insertDeliveryEvent({
      bodyPreview: '',
      ccEmail: '',
      companyId: target.companyId,
      createdAt: input.deliveredAt,
      createdBy: input.actorUserId,
      deliveryMethod: input.deliveryMethod,
      documentId: target.documentId,
      target,
      id: input.deliveryEventId,
      invoiceId: target.invoiceId,
      provider: 'manual',
      providerMessageId: null,
      recipientEmail: '',
      safeErrorMessage: null,
      status: 'succeeded',
      subject: '',
      technicalErrorCode: null,
    });

    this.statements.markApprovedInvoiceSent({
      companyId: target.companyId,
      invoiceId: target.invoiceId,
      sentAt: input.deliveredAt,
    });

    this.statements.insertManualDeliveryAuditEvent({
      action: 'invoice.marked_sent_manually',
      actorUserId: input.actorUserId,
      companyId: target.companyId,
      createdAt: input.deliveredAt,
      draftId: invoice.source_draft_id,
      id: input.auditEventId,
      invoiceId: target.invoiceId,
      invoiceNumber: invoice.invoice_number,
    });

    return { outcome: 'completed', updatedAt: input.deliveredAt };
  }
}
