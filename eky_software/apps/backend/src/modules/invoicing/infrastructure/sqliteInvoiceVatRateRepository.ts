import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import type {
  InvoiceVatRateRow,
  NewInvoiceVatRateRow,
} from '../../../database/schema.js';
import {
  sortInvoiceVatRates,
  validateInvoiceVatRates,
  type StoredInvoiceVatRate,
} from '../domain/invoiceVatRates.js';
import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';
import { InvoiceVatRatesError } from '../domain/invoiceVatRatesError.js';
import type { InvoiceVatRateRepository } from '../ports/invoiceVatRateRepository.js';
import { insertInvoiceSettingsAuditEvent } from './invoiceSettingsAuditPersistence.js';

type InvoiceVatRateInsertParameters = [
  string,
  number,
  string,
  number,
  number,
  number,
  string,
  string,
];

export class SqliteInvoiceVatRateRepository
  implements InvoiceVatRateRepository
{
  constructor(private readonly database: DatabaseConnection) {}

  async listRates(companyId: string): Promise<StoredInvoiceVatRate[]> {
    requireCompanyId(companyId);
    const rows = this.database
      .prepare<[string], InvoiceVatRateRow>(
        `
          SELECT
            company_id,
            rate_basis_points,
            label,
            is_active,
            is_default,
            sort_order,
            created_at,
            updated_at
          FROM invoice_vat_rates
          WHERE company_id = ?
          ORDER BY sort_order ASC, rate_basis_points DESC
        `,
      )
      .all(companyId);

    return rows.map(toStoredInvoiceVatRate);
  }

  async replaceRates(
    companyId: string,
    vatRates: readonly StoredInvoiceVatRate[],
    auditEvent: InvoiceSettingsAuditEvent,
  ): Promise<StoredInvoiceVatRate[]> {
    requireCompanyId(companyId);
    validateInvoiceVatRates(vatRates);

    if (vatRates.some((vatRate) => vatRate.companyId !== companyId)) {
      throw new InvoiceVatRatesError('Invoice VAT rate company id is invalid.');
    }

    const deleteStatement = this.database.prepare<[string]>(
      'DELETE FROM invoice_vat_rates WHERE company_id = ?',
    );
    const insertStatement = this.database.prepare<InvoiceVatRateInsertParameters>(
      `
        INSERT INTO invoice_vat_rates (
          company_id,
          rate_basis_points,
          label,
          is_active,
          is_default,
          sort_order,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    );
    const replace = this.database.transaction(() => {
      deleteStatement.run(companyId);

      for (const vatRate of sortInvoiceVatRates(vatRates)) {
        const row = toInvoiceVatRateRow(vatRate);
        insertStatement.run(
          row.company_id,
          row.rate_basis_points,
          row.label,
          row.is_active,
          row.is_default,
          row.sort_order,
          row.created_at,
          row.updated_at,
        );
      }

      insertInvoiceSettingsAuditEvent(this.database, auditEvent, {
        action: 'invoiceVatRates.updated',
        companyId,
      });
    });

    replace();

    return this.listRates(companyId);
  }
}

function toInvoiceVatRateRow(
  vatRate: StoredInvoiceVatRate,
): NewInvoiceVatRateRow {
  return {
    company_id: vatRate.companyId,
    rate_basis_points: vatRate.rateBasisPoints,
    label: vatRate.label,
    is_active: vatRate.isActive ? 1 : 0,
    is_default: vatRate.isDefault ? 1 : 0,
    sort_order: vatRate.sortOrder,
    created_at: vatRate.createdAt,
    updated_at: vatRate.updatedAt,
  };
}

function toStoredInvoiceVatRate(row: InvoiceVatRateRow): StoredInvoiceVatRate {
  return {
    companyId: row.company_id,
    rateBasisPoints: row.rate_basis_points,
    label: row.label,
    isActive: row.is_active === 1,
    isDefault: row.is_default === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireCompanyId(companyId: string): void {
  if (companyId.trim().length === 0) {
    throw new InvoiceVatRatesError('Company id must not be empty.');
  }
}
