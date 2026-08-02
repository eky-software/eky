import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceNumberingActiveSeriesRow,
  InvoiceNumberingSeriesEventRow,
} from '../../../database/schema.js';
import {
  calculateMinimumSafeInvoiceSequenceNumber,
  validateInvoiceNumberingSeriesFirstSequenceNumber,
} from '../domain/calculateMinimumSafeInvoiceSequenceNumber.js';
import {
  validateInvoiceNumberSeriesKey,
  validateInvoiceNumberingSettings,
  type StoredInvoiceNumberingSettings,
} from '../domain/invoiceNumbering.js';
import { InvoiceNumberingError } from '../domain/invoiceNumberingError.js';
import {
  validateInvoiceNumberingActiveSeries,
  validateInvoiceNumberingSeriesEvent,
  validateInvoiceNumberingSeriesOverview,
  type InvoiceNumberingSeriesEvent,
  type InvoiceNumberingSeriesOverview,
} from '../domain/invoiceNumberingSeries.js';
import type {
  ActivateInvoiceNumberingSeriesPersistenceInput,
  ActivateInvoiceNumberingSeriesPersistenceResult,
  InvoiceNumberingSeriesActivationPreviewCriteria,
  InvoiceNumberingSeriesRepository,
} from '../ports/invoiceNumberingSeriesRepository.js';
import {
  toNumberingSettings,
  type InvoiceNumberingSettingsRow,
} from './invoiceApprovalPersistenceRows.js';

type CompanyParameters = [string];
type CompanyAndSeriesParameters = [string, string];
type ActiveSeriesUpdateParameters = [
  string,
  number,
  string,
  string,
  string,
  string,
  number,
];
type SettingsInsertParameters = [
  string,
  string,
  string,
  number,
  number,
  number,
  string,
  string,
];
type EventInsertParameters = [
  string,
  string,
  string,
  string,
  string,
  string,
  string | null,
  string,
];

interface InvoiceNumberRow {
  invoice_number: string;
}

interface NumberingHistoryRow extends InvoiceNumberingSeriesEventRow {
  mode: string;
  fiscal_year_start_month: number;
  sequence_padding: number;
  first_sequence_number: number;
  settings_created_at: string;
  settings_updated_at: string;
}

interface ActiveSettingsRow extends InvoiceNumberingActiveSeriesRow {
  mode: string;
  fiscal_year_start_month: number;
  sequence_padding: number;
  first_sequence_number: number;
  settings_created_at: string;
  settings_updated_at: string;
}

export class SqliteInvoiceNumberingSeriesRepository
  implements InvoiceNumberingSeriesRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async getOverview(
    companyId: string,
  ): Promise<InvoiceNumberingSeriesOverview | undefined> {
    requireCompanyId(companyId);
    return this.readOverview(companyId);
  }

  async getActivationPreview(
    criteria: InvoiceNumberingSeriesActivationPreviewCriteria,
  ) {
    requireCompanyId(criteria.companyId);

    if (this.readActiveSeries(criteria.companyId) === undefined) {
      return undefined;
    }

    return calculateMinimumSafeInvoiceSequenceNumber({
      existingInvoiceNumbers: this.readExistingInvoiceNumbers(
        criteria.companyId,
      ),
      target: criteria.target,
    });
  }

  async activate(
    input: ActivateInvoiceNumberingSeriesPersistenceInput,
  ): Promise<ActivateInvoiceNumberingSeriesPersistenceResult> {
    validateActivationInput(input);

    const activateInTransaction = this.database.transaction(
      (): ActivateInvoiceNumberingSeriesPersistenceResult => {
        const current = this.readActiveSeries(input.activeSeries.companyId);

        if (current === undefined) {
          return { outcome: 'notFound' };
        }

        if (
          current.active_series_key !== input.expectedActiveSeriesKey ||
          current.revision !== input.expectedRevision
        ) {
          return { outcome: 'conflict' };
        }

        const nextSettingsAlreadyExists = this.database
          .prepare<CompanyAndSeriesParameters, { value: number }>(
            `
              SELECT 1 AS value
              FROM invoice_numbering_settings
              WHERE company_id = ? AND series_key = ?
            `,
          )
          .get(input.nextSettings.companyId, input.nextSettings.seriesKey);

        if (nextSettingsAlreadyExists !== undefined) {
          return { outcome: 'conflict' };
        }

        const safeStart = calculateMinimumSafeInvoiceSequenceNumber({
          existingInvoiceNumbers: this.readExistingInvoiceNumbers(
            input.nextSettings.companyId,
          ),
          target: {
            mode: input.nextSettings.mode,
            fiscalYearStartMonth: input.nextSettings.fiscalYearStartMonth,
            sequencePadding: input.nextSettings.sequencePadding,
          },
        });

        try {
          validateInvoiceNumberingSeriesFirstSequenceNumber(
            input.nextSettings.firstSequenceNumber,
            safeStart,
          );
        } catch (error) {
          if (error instanceof InvoiceNumberingError) {
            return { outcome: 'unsafeFirstSequenceNumber' };
          }

          throw error;
        }

        this.insertSettings(input.nextSettings);

        const pointerResult = this.database
          .prepare<ActiveSeriesUpdateParameters>(
            `
              UPDATE invoice_numbering_active_series
              SET
                active_series_key = ?,
                revision = ?,
                updated_at = ?,
                updated_by = ?
              WHERE
                company_id = ?
                AND active_series_key = ?
                AND revision = ?
            `,
          )
          .run(
            input.activeSeries.activeSeriesKey,
            input.activeSeries.revision,
            input.activeSeries.updatedAt,
            input.activeSeries.updatedBy,
            input.activeSeries.companyId,
            input.expectedActiveSeriesKey,
            input.expectedRevision,
          );

        if (pointerResult.changes !== 1) {
          throw new InvoiceNumberingError(
            'Active invoice numbering series changed during activation.',
          );
        }

        this.insertEvent(input.event);

        const overview = this.readOverview(input.activeSeries.companyId);

        if (overview === undefined) {
          throw new InvoiceNumberingError(
            'Activated invoice numbering series was not found.',
          );
        }

        validateInvoiceNumberingSeriesOverview(overview);

        return { outcome: 'activated', overview };
      },
    );

    return activateInTransaction.immediate();
  }

  private readActiveSeries(
    companyId: string,
  ): InvoiceNumberingActiveSeriesRow | undefined {
    return this.database
      .prepare<CompanyParameters, InvoiceNumberingActiveSeriesRow>(
        `
          SELECT
            company_id,
            active_series_key,
            revision,
            updated_at,
            updated_by
          FROM invoice_numbering_active_series
          WHERE company_id = ?
        `,
      )
      .get(companyId);
  }

  private readExistingInvoiceNumbers(companyId: string): string[] {
    return this.database
      .prepare<CompanyParameters, InvoiceNumberRow>(
        `
          SELECT invoice_number
          FROM invoices
          WHERE company_id = ?
        `,
      )
      .all(companyId)
      .map((row) => row.invoice_number);
  }

  private readOverview(
    companyId: string,
  ): InvoiceNumberingSeriesOverview | undefined {
    const activeRow = this.database
      .prepare<CompanyParameters, ActiveSettingsRow>(
        `
          SELECT
            active.company_id,
            active.active_series_key,
            active.revision,
            active.updated_at,
            active.updated_by,
            settings.mode,
            settings.fiscal_year_start_month,
            settings.sequence_padding,
            settings.first_sequence_number,
            settings.created_at AS settings_created_at,
            settings.updated_at AS settings_updated_at
          FROM invoice_numbering_active_series AS active
          INNER JOIN invoice_numbering_settings AS settings
            ON settings.company_id = active.company_id
            AND settings.series_key = active.active_series_key
          WHERE active.company_id = ?
        `,
      )
      .get(companyId);

    if (activeRow === undefined) {
      return undefined;
    }

    const historyRows = this.database
      .prepare<CompanyParameters, NumberingHistoryRow>(
        `
          SELECT
            events.id,
            events.company_id,
            events.actor_user_id,
            events.previous_series_key,
            events.next_series_key,
            events.reason_code,
            events.reason_note,
            events.occurred_at,
            settings.mode,
            settings.fiscal_year_start_month,
            settings.sequence_padding,
            settings.first_sequence_number,
            settings.created_at AS settings_created_at,
            settings.updated_at AS settings_updated_at
          FROM invoice_numbering_series_events AS events
          INNER JOIN invoice_numbering_settings AS settings
            ON settings.company_id = events.company_id
            AND settings.series_key = events.previous_series_key
          WHERE events.company_id = ?
          ORDER BY events.occurred_at DESC, events.id DESC
        `,
      )
      .all(companyId);

    return {
      activeSeries: {
        companyId: activeRow.company_id,
        activeSeriesKey: activeRow.active_series_key,
        revision: activeRow.revision,
        updatedAt: activeRow.updated_at,
        updatedBy: activeRow.updated_by,
      },
      activeSettings: toNumberingSettings(
        activeRow.company_id,
        activeRow.active_series_key,
        toSettingsRow(activeRow),
      ),
      history: historyRows.map((row) => ({
        event: toEvent(row),
        settings: toNumberingSettings(
          row.company_id,
          row.previous_series_key,
          toSettingsRow(row),
        ),
      })),
    };
  }

  private insertSettings(settings: StoredInvoiceNumberingSettings): void {
    this.database
      .prepare<SettingsInsertParameters>(
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
        `,
      )
      .run(
        settings.companyId,
        settings.seriesKey,
        settings.mode,
        settings.fiscalYearStartMonth,
        settings.sequencePadding,
        settings.firstSequenceNumber,
        settings.createdAt,
        settings.updatedAt,
      );
  }

  private insertEvent(event: InvoiceNumberingSeriesEvent): void {
    this.database
      .prepare<EventInsertParameters>(
        `
          INSERT INTO invoice_numbering_series_events (
            id,
            company_id,
            actor_user_id,
            previous_series_key,
            next_series_key,
            reason_code,
            reason_note,
            occurred_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        event.id,
        event.companyId,
        event.actorUserId,
        event.previousSeriesKey,
        event.nextSeriesKey,
        event.reasonCode,
        event.reasonNote,
        event.occurredAt,
      );
  }
}

function validateActivationInput(
  input: ActivateInvoiceNumberingSeriesPersistenceInput,
): void {
  validateInvoiceNumberingActiveSeries(input.activeSeries);
  validateInvoiceNumberingSeriesEvent(input.event);
  requireCompanyId(input.nextSettings.companyId);
  validateInvoiceNumberSeriesKey(input.expectedActiveSeriesKey);
  validateInvoiceNumberSeriesKey(input.nextSettings.seriesKey);
  validateInvoiceNumberingSettings(input.nextSettings);

  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 1 ||
    input.activeSeries.companyId !== input.nextSettings.companyId ||
    input.activeSeries.companyId !== input.event.companyId ||
    input.activeSeries.activeSeriesKey !== input.nextSettings.seriesKey ||
    input.activeSeries.activeSeriesKey !== input.event.nextSeriesKey ||
    input.expectedActiveSeriesKey !== input.event.previousSeriesKey ||
    input.activeSeries.revision !== input.expectedRevision + 1
  ) {
    throw new InvoiceNumberingError(
      'Invoice numbering series activation input is inconsistent.',
    );
  }
}

function toSettingsRow(
  row: ActiveSettingsRow | NumberingHistoryRow,
): InvoiceNumberingSettingsRow {
  return {
    mode: row.mode,
    fiscal_year_start_month: row.fiscal_year_start_month,
    sequence_padding: row.sequence_padding,
    first_sequence_number: row.first_sequence_number,
    created_at: row.settings_created_at,
    updated_at: row.settings_updated_at,
  };
}

function toEvent(row: NumberingHistoryRow): InvoiceNumberingSeriesEvent {
  return {
    id: row.id,
    companyId: row.company_id,
    actorUserId: row.actor_user_id,
    previousSeriesKey: row.previous_series_key,
    nextSeriesKey: row.next_series_key,
    reasonCode:
      row.reason_code as InvoiceNumberingSeriesEvent['reasonCode'],
    reasonNote: row.reason_note,
    occurredAt: row.occurred_at,
  };
}

function requireCompanyId(companyId: string): void {
  if (companyId.trim().length === 0) {
    throw new InvoiceNumberingError('Company id must not be empty.');
  }
}
