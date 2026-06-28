import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  CompanySettingsRow,
  CustomerRow,
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  NewInvoiceAuditEventRow,
  NewInvoiceLineRow,
  NewInvoiceNumberSequenceRow,
  NewInvoiceRow,
} from '../../../database/schema.js';
import { ApproveInvoiceDraftError } from '../application/approveInvoiceDraftError.js';
import {
  formatInvoiceNumber,
  resolveInvoiceNumberSequenceScope,
  validateInvoiceNumberingSettings,
  validateInvoiceSequenceNumber,
  type InvoiceNumberingMode,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import {
  createFinnishDomesticReferenceNumber,
  type ReferenceNumberType,
} from '../domain/invoiceReferenceNumber.js';
import type {
  ApproveInvoiceDraftPersistenceInput,
  ApprovedInvoiceResult,
  InvoiceApprovalRepository,
} from '../ports/invoiceApprovalRepository.js';

type InvoiceDraftApprovalKeyParameters = [string, string];
type InvoiceNumberingSettingsKeyParameters = [string, string];
type InvoiceNumberSequenceKeyParameters = [string, string, string];

type InvoiceNumberSequenceUpsertParameters = [
  string,
  string,
  string,
  number,
  string,
  string,
];

type InvoiceInsertParameters = [
  string, // id
  string, // company_id
  string, // source_draft_id
  string, // invoice_number
  string | null, // reference_number
  string | null, // reference_number_type
  string, // series_key
  string, // sequence_scope
  number, // sequence_number
  string, // numbering_mode
  string, // status
  string, // customer_id
  string, // customer_number_snapshot
  string, // customer_name_snapshot
  string, // customer_business_id_snapshot
  string, // customer_type_snapshot
  string, // company_name_snapshot
  string, // company_business_id_snapshot
  string, // invoice_date
  string, // due_date
  number, // payment_term_days
  string, // price_input_mode
  string, // subject
  string, // order_number
  string, // note
  number, // total_net_cents
  number, // total_vat_cents
  number, // total_gross_cents
  string, // created_at
  string, // approved_at
  string, // updated_at
];

type InvoiceLineInsertParameters = [
  string,
  string,
  number,
  string,
  string,
  number,
  string,
  number,
  number,
  string,
  number,
  number,
  number,
  number,
  number,
  number,
  string,
];

type InvoiceAuditEventInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

type InvoiceDraftApproveParameters = [string, string, string, string, string];

interface InvoiceNumberingSettingsRow {
  mode: string;
  fiscal_year_start_month: number;
  sequence_padding: number;
  first_sequence_number: number;
  created_at: string;
  updated_at: string;
}

interface InvoiceNumberSequenceRow {
  last_sequence_number: number;
  created_at: string;
  updated_at: string;
}

interface InvoiceSnapshotData {
  companyBusinessId: string;
  companyName: string;
  customerBusinessId: string;
  customerName: string;
  customerNumber: string;
  customerType: string;
}

interface StoredDiscount {
  type: 'fixed' | 'none' | 'percentage';
  value: number;
}

function toStoredDiscount(discountType: string, discountValue: number): StoredDiscount {
  if (discountType === 'none') {
    return { type: 'none', value: 0 };
  }

  if (discountType === 'percentage') {
    return { type: 'percentage', value: discountValue };
  }

  if (discountType === 'fixed') {
    return { type: 'fixed', value: discountValue };
  }

  throw new ApproveInvoiceDraftError('Stored invoice draft discount type is invalid.');
}

function toNumberingSettings(
  companyId: string,
  seriesKey: string,
  row: InvoiceNumberingSettingsRow,
): StoredInvoiceNumberingSettings {
  return {
    companyId,
    seriesKey,
    mode: row.mode as InvoiceNumberingMode,
    fiscalYearStartMonth: row.fiscal_year_start_month,
    sequencePadding: row.sequence_padding,
    firstSequenceNumber: row.first_sequence_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createInvoiceRow(
  input: ApproveInvoiceDraftPersistenceInput,
  draft: InvoiceDraftTable,
  settings: StoredInvoiceNumberingSettings,
  sequenceScope: string,
  sequenceNumber: number,
  invoiceNumber: string,
  referenceNumber: string,
  referenceNumberType: ReferenceNumberType,
  snapshot: InvoiceSnapshotData,
): NewInvoiceRow {
  return {
    id: input.invoiceId,
    company_id: input.companyId,
    source_draft_id: input.draftId,
    invoice_number: invoiceNumber,
    reference_number: referenceNumber,
    reference_number_type: referenceNumberType,
    series_key: input.seriesKey,
    sequence_scope: sequenceScope,
    sequence_number: sequenceNumber,
    numbering_mode: settings.mode,
    status: 'approved',
    customer_id: draft.customer_id,
    customer_number_snapshot: snapshot.customerNumber,
    customer_name_snapshot: snapshot.customerName,
    customer_business_id_snapshot: snapshot.customerBusinessId,
    customer_type_snapshot: snapshot.customerType,
    company_name_snapshot: snapshot.companyName,
    company_business_id_snapshot: snapshot.companyBusinessId,
    invoice_date: draft.invoice_date,
    due_date: draft.due_date,
    payment_term_days: draft.payment_term_days,
    price_input_mode: draft.price_input_mode,
    subject: draft.subject,
    order_number: draft.order_number,
    note: draft.note,
    total_net_cents: draft.net_total_cents,
    total_vat_cents: draft.vat_total_cents,
    total_gross_cents: draft.gross_total_cents,
    created_at: input.approvedAt,
    approved_at: input.approvedAt,
    updated_at: input.approvedAt,
  };
}

function createInvoiceLineRows(
  input: ApproveInvoiceDraftPersistenceInput,
  lines: InvoiceDraftLineTable[],
): NewInvoiceLineRow[] {
  return lines.map((line) => {
    const discount = toStoredDiscount(line.discount_type, line.discount_value);

    return {
      id: line.id,
      invoice_id: input.invoiceId,
      line_order: line.position,
      code: line.code,
      description: line.description,
      quantity_hundredths: line.quantity_hundredths,
      unit: line.unit,
      unit_price_cents: line.unit_price_cents,
      vat_rate_basis_points: line.vat_rate_basis_points,
      discount_type: discount.type,
      discount_value: discount.value,
      base_cents: line.base_cents,
      discount_cents: line.discount_cents,
      net_cents: line.net_cents,
      vat_cents: line.vat_cents,
      gross_cents: line.gross_cents,
      created_at: input.approvedAt,
    };
  });
}

function createAuditEventRow(
  input: ApproveInvoiceDraftPersistenceInput,
  invoiceNumber: string,
): NewInvoiceAuditEventRow {
  return {
    id: input.auditEventId,
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    action: 'invoice.approved',
    draft_id: input.draftId,
    invoice_id: input.invoiceId,
    invoice_number: invoiceNumber,
    created_at: input.approvedAt,
  };
}

export class SqliteInvoiceApprovalRepository implements InvoiceApprovalRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async approveDraft(
    input: ApproveInvoiceDraftPersistenceInput,
  ): Promise<ApprovedInvoiceResult | undefined> {
    const approveTransaction = this.database.transaction(() => {
      const draft = this.getDraftForApproval(input.companyId, input.draftId);

      if (
        draft === undefined ||
        draft.status !== 'draft' ||
        draft.approved_invoice_id !== null
      ) {
        return undefined;
      }

      const lines = this.getDraftLinesForApproval(input.companyId, input.draftId);

      if (lines.length === 0) {
        throw new ApproveInvoiceDraftError(
          'Invoice draft must have at least one line before approval.',
        );
      }

      const settings = this.getNumberingSettings(input.companyId, input.seriesKey);

      if (settings === undefined) {
        throw new ApproveInvoiceDraftError('Invoice numbering settings were not found.');
      }

      validateInvoiceNumberingSettings(settings);

      const sequenceScope = resolveInvoiceNumberSequenceScope(
        settings,
        draft.invoice_date,
      );
      const currentSequence = this.getNumberSequence(
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
      const snapshot = this.getSnapshotData(input.companyId, draft.customer_id);
      const invoiceRow = createInvoiceRow(
        input,
        draft,
        settings,
        sequenceScope,
        sequenceNumber,
        invoiceNumber,
        referenceNumber,
        referenceNumberType,
        snapshot,
      );
      const lineRows = createInvoiceLineRows(input, lines);
      const auditEventRow = createAuditEventRow(input, invoiceNumber);

      this.upsertNumberSequence({
        company_id: input.companyId,
        series_key: input.seriesKey,
        sequence_scope: sequenceScope,
        last_sequence_number: sequenceNumber,
        created_at: currentSequence?.created_at ?? input.approvedAt,
        updated_at: input.approvedAt,
      });
      this.insertInvoice(invoiceRow);
      this.insertInvoiceLines(lineRows);
      this.insertAuditEvent(auditEventRow);
      this.markDraftApproved(input);

      return {
        invoiceId: input.invoiceId,
        draftId: input.draftId,
        invoiceNumber,
        referenceNumber,
        referenceNumberType,
        sequenceNumber,
        sequenceScope,
        numberingMode: settings.mode,
        status: 'approved' as const,
      };
    });

    return approveTransaction();
  }

  private getDraftForApproval(
    companyId: string,
    draftId: string,
  ): InvoiceDraftTable | undefined {
    return this.database
      .prepare<InvoiceDraftApprovalKeyParameters, InvoiceDraftTable>(
        `
          SELECT
            id,
            company_id,
            customer_id,
            status,
            invoice_date,
            due_date,
            payment_term_days,
            price_input_mode,
            subject,
            order_number,
            note,
            net_total_cents,
            vat_total_cents,
            gross_total_cents,
            created_at,
            updated_at,
            approved_invoice_id,
            approved_at
          FROM invoice_drafts
          WHERE company_id = ? AND id = ?
        `,
      )
      .get(companyId, draftId);
  }

  private getDraftLinesForApproval(
    companyId: string,
    draftId: string,
  ): InvoiceDraftLineTable[] {
    return this.database
      .prepare<InvoiceDraftApprovalKeyParameters, InvoiceDraftLineTable>(
        `
          SELECT
            invoice_draft_lines.id,
            invoice_draft_lines.invoice_draft_id,
            invoice_draft_lines.position,
            invoice_draft_lines.code,
            invoice_draft_lines.description,
            invoice_draft_lines.quantity_hundredths,
            invoice_draft_lines.unit,
            invoice_draft_lines.unit_price_cents,
            invoice_draft_lines.vat_rate_basis_points,
            invoice_draft_lines.discount_type,
            invoice_draft_lines.discount_value,
            invoice_draft_lines.base_cents,
            invoice_draft_lines.discount_cents,
            invoice_draft_lines.net_cents,
            invoice_draft_lines.vat_cents,
            invoice_draft_lines.gross_cents
          FROM invoice_draft_lines
          INNER JOIN invoice_drafts
            ON invoice_drafts.id = invoice_draft_lines.invoice_draft_id
          WHERE
            invoice_drafts.company_id = ?
            AND invoice_draft_lines.invoice_draft_id = ?
          ORDER BY invoice_draft_lines.position
        `,
      )
      .all(companyId, draftId);
  }

  private getNumberingSettings(
    companyId: string,
    seriesKey: string,
  ): StoredInvoiceNumberingSettings | undefined {
    const row = this.database
      .prepare<InvoiceNumberingSettingsKeyParameters, InvoiceNumberingSettingsRow>(
        `
          SELECT
            mode,
            fiscal_year_start_month,
            sequence_padding,
            first_sequence_number,
            created_at,
            updated_at
          FROM invoice_numbering_settings
          WHERE company_id = ? AND series_key = ?
        `,
      )
      .get(companyId, seriesKey);

    return row === undefined
      ? undefined
      : toNumberingSettings(companyId, seriesKey, row);
  }

  private getNumberSequence(
    companyId: string,
    seriesKey: string,
    sequenceScope: string,
  ): InvoiceNumberSequenceRow | undefined {
    return this.database
      .prepare<InvoiceNumberSequenceKeyParameters, InvoiceNumberSequenceRow>(
        `
          SELECT
            last_sequence_number,
            created_at,
            updated_at
          FROM invoice_number_sequences
          WHERE
            company_id = ?
            AND series_key = ?
            AND sequence_scope = ?
        `,
      )
      .get(companyId, seriesKey, sequenceScope);
  }

  private getSnapshotData(
    companyId: string,
    customerId: string,
  ): InvoiceSnapshotData {
    const customer = this.database
      .prepare<[string, string], CustomerRow>(
        `
          SELECT *
          FROM customers
          WHERE company_id = ? AND id = ?
        `,
      )
      .get(companyId, customerId);

    if (customer === undefined) {
      throw new ApproveInvoiceDraftError(
        'Invoice customer snapshot could not be created.',
      );
    }

    const companySettings = this.database
      .prepare<[string], CompanySettingsRow>(
        `
          SELECT *
          FROM company_settings
          WHERE company_id = ?
        `,
      )
      .get(companyId);

    return {
      companyBusinessId: companySettings?.business_id ?? '',
      companyName: companySettings?.company_name ?? '',
      customerBusinessId: customer.business_id,
      customerName: customer.name,
      customerNumber: customer.customer_number,
      customerType: customer.customer_type,
    };
  }

  private upsertNumberSequence(sequence: NewInvoiceNumberSequenceRow): void {
    this.database
      .prepare<InvoiceNumberSequenceUpsertParameters>(
        `
          INSERT INTO invoice_number_sequences (
            company_id,
            series_key,
            sequence_scope,
            last_sequence_number,
            created_at,
            updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(company_id, series_key, sequence_scope) DO UPDATE SET
            last_sequence_number = excluded.last_sequence_number,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        sequence.company_id,
        sequence.series_key,
        sequence.sequence_scope,
        sequence.last_sequence_number,
        sequence.created_at,
        sequence.updated_at,
      );
  }

  private insertInvoice(invoice: NewInvoiceRow): void {
    this.database
      .prepare<InvoiceInsertParameters>(
        `
          INSERT INTO invoices (
            id,
            company_id,
            source_draft_id,
            invoice_number,
            reference_number,
            reference_number_type,
            series_key,
            sequence_scope,
            sequence_number,
            numbering_mode,
            status,
            customer_id,
            customer_number_snapshot,
            customer_name_snapshot,
            customer_business_id_snapshot,
            customer_type_snapshot,
            company_name_snapshot,
            company_business_id_snapshot,
            invoice_date,
            due_date,
            payment_term_days,
            price_input_mode,
            subject,
            order_number,
            note,
            total_net_cents,
            total_vat_cents,
            total_gross_cents,
            created_at,
            approved_at,
            updated_at
          )
          VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            ?
          )
        `,
      )
      .run(
        invoice.id,
        invoice.company_id,
        invoice.source_draft_id,
        invoice.invoice_number,
        invoice.reference_number,
        invoice.reference_number_type,
        invoice.series_key,
        invoice.sequence_scope,
        invoice.sequence_number,
        invoice.numbering_mode,
        invoice.status,
        invoice.customer_id,
        invoice.customer_number_snapshot,
        invoice.customer_name_snapshot,
        invoice.customer_business_id_snapshot,
        invoice.customer_type_snapshot,
        invoice.company_name_snapshot,
        invoice.company_business_id_snapshot,
        invoice.invoice_date,
        invoice.due_date,
        invoice.payment_term_days,
        invoice.price_input_mode,
        invoice.subject,
        invoice.order_number,
        invoice.note,
        invoice.total_net_cents,
        invoice.total_vat_cents,
        invoice.total_gross_cents,
        invoice.created_at,
        invoice.approved_at,
        invoice.updated_at,
      );
  }

  private insertInvoiceLines(lines: NewInvoiceLineRow[]): void {
    const insertLine = this.database.prepare<InvoiceLineInsertParameters>(
      `
        INSERT INTO invoice_lines (
          id,
          invoice_id,
          line_order,
          code,
          description,
          quantity_hundredths,
          unit,
          unit_price_cents,
          vat_rate_basis_points,
          discount_type,
          discount_value,
          base_cents,
          discount_cents,
          net_cents,
          vat_cents,
          gross_cents,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );

    for (const line of lines) {
      insertLine.run(
        line.id,
        line.invoice_id,
        line.line_order,
        line.code,
        line.description,
        line.quantity_hundredths,
        line.unit,
        line.unit_price_cents,
        line.vat_rate_basis_points,
        line.discount_type,
        line.discount_value,
        line.base_cents,
        line.discount_cents,
        line.net_cents,
        line.vat_cents,
        line.gross_cents,
        line.created_at,
      );
    }
  }

  private insertAuditEvent(auditEvent: NewInvoiceAuditEventRow): void {
    this.database
      .prepare<InvoiceAuditEventInsertParameters>(
        `
          INSERT INTO invoice_audit_events (
            id,
            company_id,
            actor_user_id,
            action,
            draft_id,
            invoice_id,
            invoice_number,
            created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        auditEvent.id,
        auditEvent.company_id,
        auditEvent.actor_user_id,
        auditEvent.action,
        auditEvent.draft_id,
        auditEvent.invoice_id,
        auditEvent.invoice_number,
        auditEvent.created_at,
      );
  }

  private markDraftApproved(input: ApproveInvoiceDraftPersistenceInput): void {
    const result = this.database
      .prepare<InvoiceDraftApproveParameters>(
        `
          UPDATE invoice_drafts
          SET
            approved_invoice_id = ?,
            approved_at = ?,
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'draft'
            AND approved_invoice_id IS NULL
        `,
      )
      .run(
        input.invoiceId,
        input.approvedAt,
        input.approvedAt,
        input.companyId,
        input.draftId,
      );

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Invoice draft could not be marked as approved.',
      );
    }
  }
}
