import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type { InvoiceDeliveryEvent } from '../domain/invoiceDeliveryEvent.js';
import type { InvoiceDeliveryEventSummary } from '../domain/invoiceDeliveryEventSummary.js';
import { InvoiceDeliveryConflictError } from '../domain/invoiceDeliveryConflictError.js';
import type { InvoiceDeliveryEventReader } from '../ports/invoiceDeliveryEventReader.js';
import type { InvoiceDeliveryEventRepository } from '../ports/invoiceDeliveryEventRepository.js';
import type { CompleteInvoiceDeliveryEventInput } from '../ports/invoiceDeliveryEventRepository.js';
import type {
  CompleteSuccessfulInvoiceEmailDeliveryInput,
  CompleteSuccessfulInvoiceEmailDeliveryResult,
  InvoiceEmailDeliveryFinalizer,
} from '../ports/invoiceEmailDeliveryFinalizer.js';
import type {
  CompleteManualInvoiceDeliveryInput,
  CompleteManualInvoiceDeliveryResult,
  InvoiceManualDeliveryFinalizer,
} from '../ports/invoiceManualDeliveryFinalizer.js';
import { SqliteInvoiceDeliveryEventQueries } from './sqliteInvoiceDeliveryEventQueries.js';
import { SqliteInvoiceDeliveryEventStatements } from './sqliteInvoiceDeliveryEventStatements.js';

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
    input: CompleteSuccessfulInvoiceEmailDeliveryInput,
  ): Promise<CompleteSuccessfulInvoiceEmailDeliveryResult> {
    const completeTransaction = this.database.transaction(() =>
      this.completeSuccessfulEmailDeliveryWithinTransaction(input),
    );

    return completeTransaction();
  }

  async completeDeliveryEvent(
    input: CompleteInvoiceDeliveryEventInput,
  ): Promise<void> {
    this.statements.completeDeliveryEvent(input);
  }

  async completeManualDelivery(
    input: CompleteManualInvoiceDeliveryInput,
  ): Promise<CompleteManualInvoiceDeliveryResult | undefined> {
    const completeTransaction = this.database.transaction(() =>
      this.completeManualDeliveryWithinTransaction(input),
    );

    return completeTransaction();
  }

  async hasUnresolvedDeliveryEvent(
    companyId: string,
    invoiceId: string,
  ): Promise<boolean> {
    return this.queries.hasUnresolvedDeliveryEvent(companyId, invoiceId);
  }

  async listDeliveryEvents(
    companyId: string,
    invoiceId: string,
  ): Promise<InvoiceDeliveryEventSummary[]> {
    return this.queries.listDeliveryEvents(companyId, invoiceId);
  }

  async saveDeliveryEvent(
    event: InvoiceDeliveryEvent,
  ): Promise<InvoiceDeliveryEvent> {
    this.statements.insertDeliveryEvent(event);

    return event;
  }

  private completeSuccessfulEmailDeliveryWithinTransaction(
    input: CompleteSuccessfulInvoiceEmailDeliveryInput,
  ): CompleteSuccessfulInvoiceEmailDeliveryResult {
    const invoice = this.queries.getSuccessfulEmailDeliveryInvoice(
      input.companyId,
      input.invoiceId,
    );

    if (invoice === undefined) {
      throw new Error('Approved invoice could not be finalized after delivery.');
    }

    this.statements.completeSuccessfulEmailDeliveryEvent({
      companyId: input.companyId,
      eventId: input.eventId,
      invoiceId: input.invoiceId,
      providerMessageId: input.providerMessageId,
    });

    if (invoice.status === 'approved') {
      this.statements.markApprovedInvoiceSent({
        companyId: input.companyId,
        invoiceId: input.invoiceId,
        sentAt: input.sentAt,
      });
    }

    return {
      invoiceStatus: 'sent',
      updatedAt:
        invoice.status === 'approved' ? input.sentAt : invoice.updated_at,
      wasResend: invoice.status === 'sent',
    };
  }

  private completeManualDeliveryWithinTransaction(
    input: CompleteManualInvoiceDeliveryInput,
  ): CompleteManualInvoiceDeliveryResult | undefined {
    const invoice = this.queries.getManualDeliveryInvoice(
      input.companyId,
      input.invoiceId,
    );

    if (invoice === undefined) {
      return undefined;
    }

    if (invoice.status === 'sent') {
      return { updatedAt: invoice.updated_at };
    }

    const hasUnresolvedDeliveryEvent = this.queries.hasUnresolvedDeliveryEvent(
      input.companyId,
      input.invoiceId,
    );

    if (hasUnresolvedDeliveryEvent) {
      throw new InvoiceDeliveryConflictError();
    }

    this.statements.insertDeliveryEvent({
      bodyPreview: '',
      ccEmail: '',
      companyId: input.companyId,
      createdAt: input.deliveredAt,
      createdBy: input.actorUserId,
      deliveryMethod: input.deliveryMethod,
      documentId: input.documentId,
      id: input.deliveryEventId,
      invoiceId: input.invoiceId,
      provider: 'manual',
      providerMessageId: null,
      recipientEmail: '',
      safeErrorMessage: null,
      status: 'succeeded',
      subject: '',
      technicalErrorCode: null,
    });

    this.statements.markApprovedInvoiceSent({
      companyId: input.companyId,
      invoiceId: input.invoiceId,
      sentAt: input.deliveredAt,
    });

    this.statements.insertManualDeliveryAuditEvent({
      action: 'invoice.marked_sent_manually',
      actorUserId: input.actorUserId,
      companyId: input.companyId,
      createdAt: input.deliveredAt,
      draftId: invoice.source_draft_id,
      id: input.auditEventId,
      invoiceId: input.invoiceId,
      invoiceNumber: invoice.invoice_number,
    });

    return { updatedAt: input.deliveredAt };
  }
}
