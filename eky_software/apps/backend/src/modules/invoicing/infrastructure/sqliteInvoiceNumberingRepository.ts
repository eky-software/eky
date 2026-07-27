import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceNumberingSettingsRow,
  InvoiceNumberSequenceRow,
  NewInvoiceNumberingSettingsRow,
  NewInvoiceNumberSequenceRow,
} from '../../../database/schema.js';
import {
  type InvoiceNumberSequenceState,
  type StoredInvoiceNumberingSettings,
  validateInvoiceNumberSequenceScope,
  validateInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
  validateInvoiceSequenceNumber,
} from '../domain/invoiceNumbering.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';
import type { InvoiceNumberSequenceRepository } from '../ports/invoiceNumberSequenceRepository.js';
import type { InvoiceNumberingSettingsRepository } from '../ports/invoiceNumberingSettingsRepository.js';
import { insertInvoiceSettingsAuditEvent } from './invoiceSettingsAuditPersistence.js';

type InvoiceNumberingSettingsSaveParameters = [
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
];

type InvoiceNumberSequenceSaveParameters = [
  string,
  string,
  string,
  number,
  string,
  string,
];

type InvoiceNumberingKeyParameters = [string, string];
type InvoiceNumberSequenceKeyParameters = [string, string, string];

function requireCompanyId(companyId: string): void {
  if (companyId.trim().length === 0) {
    throw new InvoiceNumberingError('Company id must not be empty.');
  }
}

function validateStoredInvoiceNumberingSettings(
  settings: StoredInvoiceNumberingSettings,
): void {
  requireCompanyId(settings.companyId);
  validateInvoiceNumberSeriesKey(settings.seriesKey);
  validateInvoiceNumberingSettings(settings);
}

function validateInvoiceNumberSequenceState(
  sequence: InvoiceNumberSequenceState,
): void {
  requireCompanyId(sequence.companyId);
  validateInvoiceNumberSeriesKey(sequence.seriesKey);
  validateInvoiceNumberSequenceScope(sequence.sequenceScope);
  validateInvoiceSequenceNumber(sequence.lastSequenceNumber);
}

function toInvoiceNumberingSettingsRow(
  settings: StoredInvoiceNumberingSettings,
): NewInvoiceNumberingSettingsRow {
  return {
    company_id: settings.companyId,
    series_key: settings.seriesKey,
    mode: settings.mode,
    fiscal_year_start_month: settings.fiscalYearStartMonth,
    sequence_padding: settings.sequencePadding,
    first_sequence_number: settings.firstSequenceNumber,
    created_at: settings.createdAt,
    updated_at: settings.updatedAt,
  };
}

function toStoredInvoiceNumberingSettings(
  row: InvoiceNumberingSettingsRow,
): StoredInvoiceNumberingSettings {
  return {
    companyId: row.company_id,
    seriesKey: row.series_key,
    mode: row.mode as StoredInvoiceNumberingSettings['mode'],
    fiscalYearStartMonth: row.fiscal_year_start_month,
    sequencePadding: row.sequence_padding,
    firstSequenceNumber: row.first_sequence_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toInvoiceNumberSequenceRow(
  sequence: InvoiceNumberSequenceState,
): NewInvoiceNumberSequenceRow {
  return {
    company_id: sequence.companyId,
    series_key: sequence.seriesKey,
    sequence_scope: sequence.sequenceScope,
    last_sequence_number: sequence.lastSequenceNumber,
    created_at: sequence.createdAt,
    updated_at: sequence.updatedAt,
  };
}

function toInvoiceNumberSequenceState(
  row: InvoiceNumberSequenceRow,
): InvoiceNumberSequenceState {
  return {
    companyId: row.company_id,
    seriesKey: row.series_key,
    sequenceScope: row.sequence_scope,
    lastSequenceNumber: row.last_sequence_number,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class SqliteInvoiceNumberingRepository
  implements
    InvoiceNumberingSettingsRepository,
    InvoiceNumberSequenceRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async getSettings(
    companyId: string,
    seriesKey: string,
  ): Promise<StoredInvoiceNumberingSettings | undefined> {
    const row = this.database
      .prepare<InvoiceNumberingKeyParameters, InvoiceNumberingSettingsRow>(
        `
          SELECT
            company_id,
            series_key,
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
      : toStoredInvoiceNumberingSettings(row);
  }

  async saveSettings(
    settings: StoredInvoiceNumberingSettings,
    auditEvent: InvoiceSettingsAuditEvent,
  ): Promise<StoredInvoiceNumberingSettings> {
    validateStoredInvoiceNumberingSettings(settings);

    const row = toInvoiceNumberingSettingsRow(settings);

    const save = this.database.transaction(() => {
      this.database
        .prepare<InvoiceNumberingSettingsSaveParameters>(
          `
            INSERT INTO invoice_numbering_settings (
              company_id,
              series_key,
              mode,
              fiscal_year_start_month,
              sequence_padding,
              first_sequence_number,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(company_id, series_key) DO UPDATE SET
              mode = excluded.mode,
              fiscal_year_start_month = excluded.fiscal_year_start_month,
              sequence_padding = excluded.sequence_padding,
              first_sequence_number = excluded.first_sequence_number,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          row.company_id,
          row.series_key,
          row.mode,
          row.fiscal_year_start_month,
          row.sequence_padding,
          row.first_sequence_number,
          row.created_at,
          row.updated_at,
        );

      insertInvoiceSettingsAuditEvent(this.database, auditEvent, {
        action: 'invoiceNumberingSettings.updated',
        companyId: settings.companyId,
      });
    });

    save();

    const savedSettings = await this.getSettings(
      settings.companyId,
      settings.seriesKey,
    );

    if (savedSettings === undefined) {
      throw new InvoiceNumberingError('Saved invoice numbering settings were not found.');
    }

    return savedSettings;
  }

  async hasUsedNumbering(
    companyId: string,
    seriesKey: string,
  ): Promise<boolean> {
    const row = this.database
      .prepare<InvoiceNumberingKeyParameters, { count: number }>(
        `
          SELECT COUNT(*) AS count
          FROM invoice_number_sequences
          WHERE company_id = ? AND series_key = ?
        `,
      )
      .get(companyId, seriesKey);

    return (row?.count ?? 0) > 0;
  }

  async getSequence(
    companyId: string,
    seriesKey: string,
    sequenceScope: string,
  ): Promise<InvoiceNumberSequenceState | undefined> {
    const row = this.database
      .prepare<InvoiceNumberSequenceKeyParameters, InvoiceNumberSequenceRow>(
        `
          SELECT
            company_id,
            series_key,
            sequence_scope,
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

    return row === undefined ? undefined : toInvoiceNumberSequenceState(row);
  }

  async saveSequence(
    sequence: InvoiceNumberSequenceState,
  ): Promise<InvoiceNumberSequenceState> {
    validateInvoiceNumberSequenceState(sequence);

    const row = toInvoiceNumberSequenceRow(sequence);

    this.database
      .prepare<InvoiceNumberSequenceSaveParameters>(
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
        row.company_id,
        row.series_key,
        row.sequence_scope,
        row.last_sequence_number,
        row.created_at,
        row.updated_at,
      );

    const savedSequence = await this.getSequence(
      sequence.companyId,
      sequence.seriesKey,
      sequence.sequenceScope,
    );

    if (savedSequence === undefined) {
      throw new InvoiceNumberingError('Saved invoice number sequence was not found.');
    }

    return savedSequence;
  }
}
