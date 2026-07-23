import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  InvoiceRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import type { InvoiceTotals } from '../domain/invoiceCalculation.js';
import {
  formatInvoiceNumber,
  resolveInvoiceNumberSequenceScope,
  validateInvoiceNumberingSettings,
  validateInvoiceSequenceNumber,
  type InvoiceNumberingMode,
} from '../domain/invoiceNumbering.js';
import {
  createFinnishDomesticReferenceNumber,
  type ReferenceNumberType,
} from '../domain/invoiceReferenceNumber.js';
import type {
  ApproveInvoiceDraftPersistenceInput,
  ApprovedInvoiceResult,
  InvoiceApprovalRepository,
  ReopenApprovedInvoicePersistenceInput,
  ReopenedApprovedInvoiceResult,
  MarkApprovedInvoiceSentPersistenceInput,
  MarkApprovedInvoiceSentResult,
} from '../ports/invoiceApprovalRepository.js';
import type { InvoiceApprovalSnapshotReader } from '../ports/invoiceApprovalSnapshotReader.js';
import {
  calculateStoredDraftTotals,
  createAuditEventRow,
  createInvoiceLineRows,
  createInvoiceRow,
  createReapprovedInvoiceRow,
} from './invoiceApprovalPersistenceRows.js';
import { SqliteInvoiceApprovalQueries } from './sqliteInvoiceApprovalQueries.js';
import { SqliteInvoiceApprovalSnapshotReader } from './sqliteInvoiceApprovalSnapshotReader.js';
import { SqliteInvoiceApprovalStatements } from './sqliteInvoiceApprovalStatements.js';

export class SqliteInvoiceApprovalRepository implements InvoiceApprovalRepository {
  private readonly queries: SqliteInvoiceApprovalQueries;
  private readonly snapshotReader: InvoiceApprovalSnapshotReader;
  private readonly statements: SqliteInvoiceApprovalStatements;

  constructor(
    private readonly database: DatabaseConnection,
    snapshotReader?: InvoiceApprovalSnapshotReader,
  ) {
    this.queries = new SqliteInvoiceApprovalQueries(database);
    this.snapshotReader =
      snapshotReader ?? new SqliteInvoiceApprovalSnapshotReader(database);
    this.statements = new SqliteInvoiceApprovalStatements(database);
  }

  async approveDraft(
    input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined> {
    const approveTransaction = this.database.transaction(() =>
      this.approveDraftWithinTransaction(input),
    );

    return approveTransaction();
  }

  async reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined> {
    const reopenTransaction = this.database.transaction(() =>
      this.reopenApprovedInvoiceWithinTransaction(input),
    );

    return reopenTransaction();
  }

  async markApprovedInvoiceSent(
    input: MarkApprovedInvoiceSentPersistenceInput,
  ): Promise<MarkApprovedInvoiceSentResult | undefined> {
    const markSentTransaction = this.database.transaction(() =>
      this.markApprovedInvoiceSentWithinTransaction(input),
    );

    return markSentTransaction();
  }

  private approveDraftWithinTransaction(
    input: ApproveInvoiceDraftPersistenceInput,
  ): ApprovedInvoiceResult | undefined {
    const draft = this.queries.getDraftForApproval(
      input.companyId,
      input.draftId,
    );

    if (
      draft === undefined ||
      draft.invoice_kind !== 'standard' ||
      draft.credited_invoice_id !== null ||
      draft.status !== 'draft' ||
      draft.approved_invoice_id !== null
    ) {
      return undefined;
    }

    const lines = this.queries.getDraftLinesForApproval(
      input.companyId,
      input.draftId,
    );

    if (lines.length === 0) {
      throw new ApproveInvoiceDraftError(
        'Invoice draft must have at least one line before approval.',
      );
    }

    const totals = calculateStoredDraftTotals(draft, lines);
    const reopenedInvoice = this.queries.getReopenedInvoiceForDraft(
      input.companyId,
      input.draftId,
    );

    return reopenedInvoice === undefined
      ? this.approveNewDraftWithinTransaction(input, draft, lines, totals)
      : this.reapproveDraftWithinTransaction(
          input,
          draft,
          lines,
          totals,
          reopenedInvoice,
        );
  }

  private approveNewDraftWithinTransaction(
    input: ApproveInvoiceDraftPersistenceInput,
    draft: InvoiceDraftTable,
    lines: InvoiceDraftLineTable[],
    totals: InvoiceTotals,
  ): ApprovedInvoiceResult {
    const settings = this.queries.getNumberingSettings(
      input.companyId,
      input.seriesKey,
    );

    if (settings === undefined) {
      throw new ApproveInvoiceDraftError(
        'Invoice numbering settings were not found.',
      );
    }

    validateInvoiceNumberingSettings(settings);

    const sequenceScope = resolveInvoiceNumberSequenceScope(
      settings,
      draft.invoice_date,
    );
    const currentSequence = this.queries.getNumberSequence(
      input.companyId,
      input.seriesKey,
      sequenceScope,
    );
    const sequenceNumber =
      currentSequence === undefined
        ? settings.firstSequenceNumber
        : currentSequence.last_sequence_number + 1;

    validateInvoiceSequenceNumber(sequenceNumber);

    const invoiceNumber = formatInvoiceNumber(
      settings,
      draft.invoice_date,
      sequenceNumber,
    );
    const referenceNumberType: ReferenceNumberType = 'finnishDomestic';
    const referenceNumber = createFinnishDomesticReferenceNumber(invoiceNumber);
    const snapshot = this.snapshotReader.getSnapshotData({
      billingRecipientCustomerId: draft.billing_recipient_customer_id,
      companyId: input.companyId,
      customerId: draft.customer_id,
    });
    const invoiceRow = createInvoiceRow(
      input,
      draft,
      totals,
      settings,
      sequenceScope,
      sequenceNumber,
      invoiceNumber,
      referenceNumber,
      referenceNumberType,
      snapshot,
    );
    const lineRows = createInvoiceLineRows(input, lines);
    const auditEventRow = createAuditEventRow(
      input,
      invoiceNumber,
      'invoice.approved',
      input.approvedAt,
    );

    this.statements.upsertNumberSequence({
      company_id: input.companyId,
      series_key: input.seriesKey,
      sequence_scope: sequenceScope,
      last_sequence_number: sequenceNumber,
      created_at: currentSequence?.created_at ?? input.approvedAt,
      updated_at: input.approvedAt,
    });
    this.statements.insertInvoice(invoiceRow);
    this.statements.insertInvoiceLines(lineRows);
    this.statements.insertAuditEvent(auditEventRow);
    this.statements.markDraftApproved(input);

    return {
      invoiceId: input.invoiceId,
      draftId: input.draftId,
      invoiceNumber,
      referenceNumber,
      referenceNumberType,
      sequenceNumber,
      sequenceScope,
      numberingMode: settings.mode,
      status: 'approved',
    };
  }

  private reapproveDraftWithinTransaction(
    input: ApproveInvoiceDraftPersistenceInput,
    draft: InvoiceDraftTable,
    lines: InvoiceDraftLineTable[],
    totals: InvoiceTotals,
    reopenedInvoice: InvoiceRow,
  ): ApprovedInvoiceResult {
    const snapshot = this.snapshotReader.getSnapshotData({
      billingRecipientCustomerId: draft.billing_recipient_customer_id,
      companyId: input.companyId,
      customerId: draft.customer_id,
    });
    const reapprovedInput = {
      ...input,
      invoiceId: reopenedInvoice.id,
    };
    const invoiceRow = createReapprovedInvoiceRow(
      reapprovedInput,
      draft,
      totals,
      reopenedInvoice,
      snapshot,
    );
    const lineRows = createInvoiceLineRows(reapprovedInput, lines);
    const auditEventRow = createAuditEventRow(
      reapprovedInput,
      reopenedInvoice.invoice_number,
      'invoice.reapproved',
      input.approvedAt,
    );

    this.statements.updateInvoice(invoiceRow);
    this.statements.deleteInvoiceLines(reopenedInvoice.id);
    this.statements.insertInvoiceLines(lineRows);
    this.statements.insertAuditEvent(auditEventRow);
    this.statements.markDraftApproved(reapprovedInput);

    return {
      invoiceId: reopenedInvoice.id,
      draftId: input.draftId,
      invoiceNumber: reopenedInvoice.invoice_number,
      referenceNumber: reopenedInvoice.reference_number ?? '',
      referenceNumberType:
        (reopenedInvoice.reference_number_type ??
          'finnishDomestic') as ReferenceNumberType,
      sequenceNumber: reopenedInvoice.sequence_number,
      sequenceScope: reopenedInvoice.sequence_scope,
      numberingMode: reopenedInvoice.numbering_mode as InvoiceNumberingMode,
      status: 'approved',
    };
  }

  private reopenApprovedInvoiceWithinTransaction(
    input: ReopenApprovedInvoicePersistenceInput,
  ): ReopenedApprovedInvoiceResult | undefined {
    const invoice = this.queries.getApprovedInvoiceForReopen(
      input.companyId,
      input.invoiceId,
    );

    if (invoice === undefined) {
      return undefined;
    }

    this.statements.markInvoiceReopenedForEditing(input);
    this.statements.unlockSourceDraftForEditing(input, invoice.source_draft_id);
    const removedDocumentStoragePaths =
      this.statements.deleteApprovedInvoicePdfDocumentRows(
        input.companyId,
        input.invoiceId,
      );
    this.statements.insertAuditEvent(
      createAuditEventRow(
        {
          actorUserId: input.actorUserId,
          auditEventId: input.auditEventId,
          companyId: input.companyId,
          draftId: invoice.source_draft_id,
          invoiceId: invoice.id,
        },
        invoice.invoice_number,
        'invoice.reopened_for_edit',
        input.reopenedAt,
      ),
    );

    return {
      draftId: invoice.source_draft_id,
      invoiceId: invoice.id,
      removedDocumentStoragePaths,
    };
  }

  private markApprovedInvoiceSentWithinTransaction(
    input: MarkApprovedInvoiceSentPersistenceInput,
  ): MarkApprovedInvoiceSentResult | undefined {
    const invoice = this.queries.getApprovedInvoiceForMarkSent(
      input.companyId,
      input.invoiceId,
    );

    if (invoice === undefined) {
      return undefined;
    }

    if (invoice.status === 'sent') {
      return {
        invoiceId: invoice.id,
        status: 'sent',
      };
    }

    this.statements.markInvoiceSent(input);
    this.statements.insertAuditEvent(
      createAuditEventRow(
        {
          actorUserId: input.actorUserId,
          auditEventId: input.auditEventId,
          companyId: input.companyId,
          draftId: invoice.source_draft_id,
          invoiceId: invoice.id,
        },
        invoice.invoice_number,
        'invoice.marked_sent_manually',
        input.markedSentAt,
      ),
    );

    return {
      invoiceId: invoice.id,
      status: 'sent',
    };
  }
}
