import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceDraftLineTable,
  InvoiceDraftTable,
  InvoiceRow,
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
  ReopenApprovedInvoicePersistenceInput,
  ReopenedApprovedInvoiceResult,
} from '../ports/invoiceApprovalRepository.js';
import type { InvoiceAuditAction } from '../domain/approvedInvoice.js';
import type {
  InvoiceApprovalSnapshotData,
  InvoiceApprovalSnapshotReader,
} from '../ports/invoiceApprovalSnapshotReader.js';
import { SqliteInvoiceApprovalSnapshotReader } from './sqliteInvoiceApprovalSnapshotReader.js';

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

type InvoiceInsertParameters = NewInvoiceRow;
type InvoiceUpdateParameters = NewInvoiceRow;
type ReopenedInvoiceDraftKeyParameters = [string, string];
type ReopenedInvoiceKeyParameters = [string, string];
type InvoiceDocumentDeleteParameters = [string, string];
type InvoiceLineDeleteParameters = [string];

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
type InvoiceDraftUnlockParameters = [string, string, string, string];
type InvoiceStatusUpdateParameters = [string, string, string];

interface InvoiceAuditEventSource {
  actorUserId: string;
  auditEventId: string;
  companyId: string;
  draftId: string;
  invoiceId: string;
}

interface InvoiceDocumentStoragePathRow {
  storage_path: string;
}

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
  snapshot: InvoiceApprovalSnapshotData,
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
    customer_email_snapshot: snapshot.customerEmail,
    customer_phone_snapshot: snapshot.customerPhone,
    customer_street_address_snapshot: snapshot.customerStreetAddress,
    customer_postal_code_snapshot: snapshot.customerPostalCode,
    customer_city_snapshot: snapshot.customerCity,
    company_name_snapshot: snapshot.companyName,
    company_business_id_snapshot: snapshot.companyBusinessId,
    company_vat_number_snapshot: snapshot.companyVatNumber,
    company_street_address_snapshot: snapshot.companyStreetAddress,
    company_postal_code_snapshot: snapshot.companyPostalCode,
    company_city_snapshot: snapshot.companyCity,
    company_email_snapshot: snapshot.companyEmail,
    company_phone_snapshot: snapshot.companyPhone,
    company_website_snapshot: snapshot.companyWebsite,
    company_iban_snapshot: snapshot.companyIban,
    company_bic_snapshot: snapshot.companyBic,
    company_bank_name_snapshot: snapshot.companyBankName,
    billing_recipient_customer_id: snapshot.billingRecipientCustomerId,
    billing_recipient_customer_number_snapshot:
      snapshot.billingRecipientCustomerNumber,
    billing_recipient_name_snapshot: snapshot.billingRecipientName,
    billing_recipient_business_id_snapshot: snapshot.billingRecipientBusinessId,
    billing_recipient_customer_type_snapshot:
      snapshot.billingRecipientCustomerType,
    billing_recipient_email_snapshot: snapshot.billingRecipientEmail,
    billing_recipient_phone_snapshot: snapshot.billingRecipientPhone,
    billing_recipient_street_address_snapshot:
      snapshot.billingRecipientStreetAddress,
    billing_recipient_postal_code_snapshot: snapshot.billingRecipientPostalCode,
    billing_recipient_city_snapshot: snapshot.billingRecipientCity,
    invoice_date: draft.invoice_date,
    due_date: draft.due_date,
    payment_term_days: draft.payment_term_days,
    reminder_period_days: draft.reminder_period_days,
    late_payment_interest_basis_points: draft.late_payment_interest_basis_points,
    price_input_mode: draft.price_input_mode,
    subject: draft.subject,
    order_number: draft.order_number,
    note: draft.note,
    delivery_address_text: draft.delivery_address_text,
    total_net_cents: draft.net_total_cents,
    total_vat_cents: draft.vat_total_cents,
    total_gross_cents: draft.gross_total_cents,
    created_at: input.approvedAt,
    approved_at: input.approvedAt,
    updated_at: input.approvedAt,
  };
}

function createReapprovedInvoiceRow(
  input: ApproveInvoiceDraftPersistenceInput,
  draft: InvoiceDraftTable,
  existingInvoice: InvoiceRow,
  snapshot: InvoiceApprovalSnapshotData,
): NewInvoiceRow {
  return {
    ...createInvoiceRow(
      {
        ...input,
        invoiceId: existingInvoice.id,
      },
      draft,
      {
        companyId: existingInvoice.company_id,
        createdAt: existingInvoice.created_at,
        fiscalYearStartMonth: 1,
        firstSequenceNumber: existingInvoice.sequence_number,
        mode: existingInvoice.numbering_mode as InvoiceNumberingMode,
        sequencePadding: 0,
        seriesKey: existingInvoice.series_key,
        updatedAt: existingInvoice.updated_at,
      },
      existingInvoice.sequence_scope,
      existingInvoice.sequence_number,
      existingInvoice.invoice_number,
      existingInvoice.reference_number ?? '',
      (existingInvoice.reference_number_type ?? 'finnishDomestic') as ReferenceNumberType,
      snapshot,
    ),
    created_at: existingInvoice.created_at,
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
  input: InvoiceAuditEventSource,
  invoiceNumber: string,
  action: InvoiceAuditAction,
  createdAt: string,
): NewInvoiceAuditEventRow {
  return {
    id: input.auditEventId,
    company_id: input.companyId,
    actor_user_id: input.actorUserId,
    action,
    draft_id: input.draftId,
    invoice_id: input.invoiceId,
    invoice_number: invoiceNumber,
    created_at: createdAt,
  };
}

export class SqliteInvoiceApprovalRepository implements InvoiceApprovalRepository {
  private readonly snapshotReader: InvoiceApprovalSnapshotReader;

  constructor(
    private readonly database: DatabaseConnection,
    snapshotReader?: InvoiceApprovalSnapshotReader,
  ) {
    this.snapshotReader =
      snapshotReader ?? new SqliteInvoiceApprovalSnapshotReader(database);
  }

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

      const reopenedInvoice = this.getReopenedInvoiceForDraft(
        input.companyId,
        input.draftId,
      );

      if (reopenedInvoice !== undefined) {
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

        this.updateInvoice(invoiceRow);
        this.deleteInvoiceLines(reopenedInvoice.id);
        this.insertInvoiceLines(lineRows);
        this.insertAuditEvent(auditEventRow);
        this.markDraftApproved(reapprovedInput);

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
          status: 'approved' as const,
        };
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
      const snapshot = this.snapshotReader.getSnapshotData({
        billingRecipientCustomerId: draft.billing_recipient_customer_id,
        companyId: input.companyId,
        customerId: draft.customer_id,
      });
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
      const auditEventRow = createAuditEventRow(
        input,
        invoiceNumber,
        'invoice.approved',
        input.approvedAt,
      );

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

  async reopenApprovedInvoiceForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): Promise<ReopenedApprovedInvoiceResult | undefined> {
    const reopenTransaction = this.database.transaction(() => {
      const invoice = this.getApprovedInvoiceForReopen(
        input.companyId,
        input.invoiceId,
      );

      if (invoice === undefined) {
        return undefined;
      }

      this.markInvoiceReopenedForEditing(input);
      this.unlockSourceDraftForEditing(input, invoice.source_draft_id);
      const removedDocumentStoragePaths =
        this.deleteApprovedInvoicePdfDocumentRows(
          input.companyId,
          input.invoiceId,
        );
      this.insertAuditEvent(
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
    });

    return reopenTransaction();
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
            billing_recipient_customer_id,
            status,
            invoice_date,
            due_date,
            payment_term_days,
            reminder_period_days,
            late_payment_interest_basis_points,
            price_input_mode,
            subject,
            order_number,
            note,
            delivery_address_text,
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

  private getApprovedInvoiceForReopen(
    companyId: string,
    invoiceId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<ReopenedInvoiceKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'approved'
        `,
      )
      .get(companyId, invoiceId);
  }

  private getReopenedInvoiceForDraft(
    companyId: string,
    draftId: string,
  ): InvoiceRow | undefined {
    return this.database
      .prepare<ReopenedInvoiceDraftKeyParameters, InvoiceRow>(
        `
          SELECT *
          FROM invoices
          WHERE
            company_id = ?
            AND source_draft_id = ?
            AND status = 'reopened_for_edit'
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
            customer_email_snapshot,
            customer_phone_snapshot,
            customer_street_address_snapshot,
            customer_postal_code_snapshot,
            customer_city_snapshot,
            company_name_snapshot,
            company_business_id_snapshot,
            company_vat_number_snapshot,
            company_street_address_snapshot,
            company_postal_code_snapshot,
            company_city_snapshot,
            company_email_snapshot,
            company_phone_snapshot,
            company_website_snapshot,
            company_iban_snapshot,
            company_bic_snapshot,
            company_bank_name_snapshot,
            billing_recipient_customer_id,
            billing_recipient_customer_number_snapshot,
            billing_recipient_name_snapshot,
            billing_recipient_business_id_snapshot,
            billing_recipient_customer_type_snapshot,
            billing_recipient_email_snapshot,
            billing_recipient_phone_snapshot,
            billing_recipient_street_address_snapshot,
            billing_recipient_postal_code_snapshot,
            billing_recipient_city_snapshot,
            invoice_date,
            due_date,
            payment_term_days,
            reminder_period_days,
            late_payment_interest_basis_points,
            price_input_mode,
            subject,
            order_number,
            note,
            delivery_address_text,
            total_net_cents,
            total_vat_cents,
            total_gross_cents,
            created_at,
            approved_at,
            updated_at
          )
          VALUES (
            @id,
            @company_id,
            @source_draft_id,
            @invoice_number,
            @reference_number,
            @reference_number_type,
            @series_key,
            @sequence_scope,
            @sequence_number,
            @numbering_mode,
            @status,
            @customer_id,
            @customer_number_snapshot,
            @customer_name_snapshot,
            @customer_business_id_snapshot,
            @customer_type_snapshot,
            @customer_email_snapshot,
            @customer_phone_snapshot,
            @customer_street_address_snapshot,
            @customer_postal_code_snapshot,
            @customer_city_snapshot,
            @company_name_snapshot,
            @company_business_id_snapshot,
            @company_vat_number_snapshot,
            @company_street_address_snapshot,
            @company_postal_code_snapshot,
            @company_city_snapshot,
            @company_email_snapshot,
            @company_phone_snapshot,
            @company_website_snapshot,
            @company_iban_snapshot,
            @company_bic_snapshot,
            @company_bank_name_snapshot,
            @billing_recipient_customer_id,
            @billing_recipient_customer_number_snapshot,
            @billing_recipient_name_snapshot,
            @billing_recipient_business_id_snapshot,
            @billing_recipient_customer_type_snapshot,
            @billing_recipient_email_snapshot,
            @billing_recipient_phone_snapshot,
            @billing_recipient_street_address_snapshot,
            @billing_recipient_postal_code_snapshot,
            @billing_recipient_city_snapshot,
            @invoice_date,
            @due_date,
            @payment_term_days,
            @reminder_period_days,
            @late_payment_interest_basis_points,
            @price_input_mode,
            @subject,
            @order_number,
            @note,
            @delivery_address_text,
            @total_net_cents,
            @total_vat_cents,
            @total_gross_cents,
            @created_at,
            @approved_at,
            @updated_at
          )
        `,
      )
      .run(invoice);
  }

  private updateInvoice(invoice: NewInvoiceRow): void {
    const result = this.database
      .prepare<InvoiceUpdateParameters>(
        `
          UPDATE invoices
          SET
            status = @status,
            customer_id = @customer_id,
            customer_number_snapshot = @customer_number_snapshot,
            customer_name_snapshot = @customer_name_snapshot,
            customer_business_id_snapshot = @customer_business_id_snapshot,
            customer_type_snapshot = @customer_type_snapshot,
            customer_email_snapshot = @customer_email_snapshot,
            customer_phone_snapshot = @customer_phone_snapshot,
            customer_street_address_snapshot = @customer_street_address_snapshot,
            customer_postal_code_snapshot = @customer_postal_code_snapshot,
            customer_city_snapshot = @customer_city_snapshot,
            company_name_snapshot = @company_name_snapshot,
            company_business_id_snapshot = @company_business_id_snapshot,
            company_vat_number_snapshot = @company_vat_number_snapshot,
            company_street_address_snapshot = @company_street_address_snapshot,
            company_postal_code_snapshot = @company_postal_code_snapshot,
            company_city_snapshot = @company_city_snapshot,
            company_email_snapshot = @company_email_snapshot,
            company_phone_snapshot = @company_phone_snapshot,
            company_website_snapshot = @company_website_snapshot,
            company_iban_snapshot = @company_iban_snapshot,
            company_bic_snapshot = @company_bic_snapshot,
            company_bank_name_snapshot = @company_bank_name_snapshot,
            billing_recipient_customer_id = @billing_recipient_customer_id,
            billing_recipient_customer_number_snapshot = @billing_recipient_customer_number_snapshot,
            billing_recipient_name_snapshot = @billing_recipient_name_snapshot,
            billing_recipient_business_id_snapshot = @billing_recipient_business_id_snapshot,
            billing_recipient_customer_type_snapshot = @billing_recipient_customer_type_snapshot,
            billing_recipient_email_snapshot = @billing_recipient_email_snapshot,
            billing_recipient_phone_snapshot = @billing_recipient_phone_snapshot,
            billing_recipient_street_address_snapshot = @billing_recipient_street_address_snapshot,
            billing_recipient_postal_code_snapshot = @billing_recipient_postal_code_snapshot,
            billing_recipient_city_snapshot = @billing_recipient_city_snapshot,
            invoice_date = @invoice_date,
            due_date = @due_date,
            payment_term_days = @payment_term_days,
            reminder_period_days = @reminder_period_days,
            late_payment_interest_basis_points = @late_payment_interest_basis_points,
            price_input_mode = @price_input_mode,
            subject = @subject,
            order_number = @order_number,
            note = @note,
            delivery_address_text = @delivery_address_text,
            total_net_cents = @total_net_cents,
            total_vat_cents = @total_vat_cents,
            total_gross_cents = @total_gross_cents,
            approved_at = @approved_at,
            updated_at = @updated_at
          WHERE
            company_id = @company_id
            AND id = @id
            AND status = 'reopened_for_edit'
        `,
      )
      .run(invoice);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Reopened invoice could not be reapproved.',
      );
    }
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

  private deleteInvoiceLines(invoiceId: string): void {
    this.database
      .prepare<InvoiceLineDeleteParameters>(
        `
          DELETE FROM invoice_lines
          WHERE invoice_id = ?
        `,
      )
      .run(invoiceId);
  }

  private deleteApprovedInvoicePdfDocumentRows(
    companyId: string,
    invoiceId: string,
  ): string[] {
    const rows = this.database
      .prepare<InvoiceDocumentDeleteParameters, InvoiceDocumentStoragePathRow>(
        `
          SELECT storage_path
          FROM invoice_documents
          WHERE
            company_id = ?
            AND invoice_id = ?
            AND document_type = 'approved_invoice_pdf'
        `,
      )
      .all(companyId, invoiceId);

    this.database
      .prepare<InvoiceDocumentDeleteParameters>(
        `
          DELETE FROM invoice_documents
          WHERE
            company_id = ?
            AND invoice_id = ?
            AND document_type = 'approved_invoice_pdf'
        `,
      )
      .run(companyId, invoiceId);

    return rows.map((row) => row.storage_path);
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

  private markInvoiceReopenedForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
  ): void {
    const result = this.database
      .prepare<InvoiceStatusUpdateParameters>(
        `
          UPDATE invoices
          SET
            status = 'reopened_for_edit',
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND status = 'approved'
        `,
      )
      .run(input.reopenedAt, input.companyId, input.invoiceId);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Approved invoice could not be reopened for editing.',
      );
    }
  }

  private unlockSourceDraftForEditing(
    input: ReopenApprovedInvoicePersistenceInput,
    draftId: string,
  ): void {
    const result = this.database
      .prepare<InvoiceDraftUnlockParameters>(
        `
          UPDATE invoice_drafts
          SET
            approved_invoice_id = NULL,
            approved_at = NULL,
            updated_at = ?
          WHERE
            company_id = ?
            AND id = ?
            AND approved_invoice_id = ?
        `,
      )
      .run(input.reopenedAt, input.companyId, draftId, input.invoiceId);

    if (result.changes !== 1) {
      throw new ApproveInvoiceDraftError(
        'Approved invoice source draft could not be reopened for editing.',
      );
    }
  }
}
