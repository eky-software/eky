import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { InvoiceSettingsAuditEvent } from '../domain/invoiceSettingsAuditEvent.js';
import { SqliteInvoiceVatRateRepository } from './sqliteInvoiceVatRateRepository.js';

const migrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../../database/migrations/029_create_invoice_vat_rates.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);
const auditMigrationSql = readFileSync(
  fileURLToPath(
    new URL(
      '../../../database/migrations/036_create_invoice_settings_audit_events.sql',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('SqliteInvoiceVatRateRepository', () => {
  it('replaces and reads rates within the requested company', async () => {
    const database = new Database(':memory:');
    database.exec(migrationSql);
    database.exec(auditMigrationSql);
    const repository = new SqliteInvoiceVatRateRepository(database);

    await replaceRates(repository, 'company-1', [
      createStoredRate('company-1', 2550, true, 0),
      createStoredRate('company-1', 0, false, 1),
    ]);
    await replaceRates(repository, 'company-2', [
      createStoredRate('company-2', 1350, true, 0),
    ]);

    expect(await repository.listRates('company-1')).toMatchObject([
      { companyId: 'company-1', rateBasisPoints: 2550 },
      { companyId: 'company-1', rateBasisPoints: 0 },
    ]);
    expect(await repository.listRates('company-2')).toMatchObject([
      { companyId: 'company-2', rateBasisPoints: 1350 },
    ]);
    expect(readLatestAuditEvent(database)).toMatchObject({
      action: 'invoiceVatRates.updated',
      actor_user_id: 'local-owner',
      company_id: 'company-2',
      outcome: 'success',
    });
    database.close();
  });

  it('removes obsolete rates in the same transaction', async () => {
    const database = new Database(':memory:');
    database.exec(migrationSql);
    database.exec(auditMigrationSql);
    const repository = new SqliteInvoiceVatRateRepository(database);

    await replaceRates(repository, 'company-1', [
      createStoredRate('company-1', 2550, true, 0),
      createStoredRate('company-1', 1350, false, 1),
    ]);
    await replaceRates(repository, 'company-1', [
      createStoredRate('company-1', 2600, true, 0),
    ]);

    expect(await repository.listRates('company-1')).toMatchObject([
      { rateBasisPoints: 2600 },
    ]);
    database.close();
  });

  it('keeps the previous rates when replacing the collection fails', async () => {
    const database = new Database(':memory:');
    database.exec(migrationSql);
    database.exec(auditMigrationSql);
    const repository = new SqliteInvoiceVatRateRepository(database);

    await replaceRates(repository, 'company-1', [
      createStoredRate('company-1', 2550, true, 0),
    ]);
    database.exec(`
      CREATE TRIGGER reject_test_vat_rate
      BEFORE INSERT ON invoice_vat_rates
      WHEN NEW.rate_basis_points = 1350
      BEGIN
        SELECT RAISE(ABORT, 'test insert failure');
      END;
    `);

    await expect(
      replaceRates(repository, 'company-1', [
        createStoredRate('company-1', 1350, true, 0),
      ]),
    ).rejects.toThrow();

    expect(await repository.listRates('company-1')).toMatchObject([
      { rateBasisPoints: 2550 },
    ]);
    database.close();
  });

  it('rolls back VAT rates when the audit event cannot be written', async () => {
    const database = new Database(':memory:');
    database.exec(migrationSql);
    database.exec(auditMigrationSql);
    const repository = new SqliteInvoiceVatRateRepository(database);

    await replaceRates(repository, 'company-1', [
      createStoredRate('company-1', 2550, true, 0),
    ]);
    database.exec('DROP TABLE invoice_settings_audit_events');

    await expect(
      replaceRates(repository, 'company-1', [
        createStoredRate('company-1', 1350, true, 0),
      ]),
    ).rejects.toMatchObject({
      code: 'invoice_settings_audit_write_failed',
    });
    await expect(repository.listRates('company-1')).resolves.toMatchObject([
      { rateBasisPoints: 2550 },
    ]);
    database.close();
  });
});

function replaceRates(
  repository: SqliteInvoiceVatRateRepository,
  companyId: string,
  rates: Parameters<SqliteInvoiceVatRateRepository['replaceRates']>[1],
) {
  return repository.replaceRates(
    companyId,
    rates,
    createAuditEvent('invoiceVatRates.updated', companyId),
  );
}

function createAuditEvent(
  action: InvoiceSettingsAuditEvent['action'],
  companyId = 'dev-company',
): InvoiceSettingsAuditEvent {
  return {
    action,
    actorUserId: 'local-owner',
    companyId,
    id: `${action}-${companyId}-${Math.random()}`,
    occurredAt: '2026-07-22T18:00:00.000Z',
    outcome: 'success',
  };
}

function createStoredRate(
  companyId: string,
  rateBasisPoints: number,
  isDefault: boolean,
  sortOrder: number,
) {
  return {
    companyId,
    rateBasisPoints,
    label: `${rateBasisPoints / 100} %`,
    isActive: true,
    isDefault,
    sortOrder,
    createdAt: '2026-07-22T18:00:00.000Z',
    updatedAt: '2026-07-22T18:00:00.000Z',
  };
}

function readLatestAuditEvent(database: Database.Database) {
  return database
    .prepare(
      `
        SELECT action, actor_user_id, company_id, outcome
        FROM invoice_settings_audit_events
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1
      `,
    )
    .get();
}
