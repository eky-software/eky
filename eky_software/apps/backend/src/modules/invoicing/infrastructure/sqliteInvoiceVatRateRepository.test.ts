import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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

describe('SqliteInvoiceVatRateRepository', () => {
  it('replaces and reads rates within the requested company', async () => {
    const database = new Database(':memory:');
    database.exec(migrationSql);
    const repository = new SqliteInvoiceVatRateRepository(database);

    await repository.replaceRates('company-1', [
      createStoredRate('company-1', 2550, true, 0),
      createStoredRate('company-1', 0, false, 1),
    ]);
    await repository.replaceRates('company-2', [
      createStoredRate('company-2', 1350, true, 0),
    ]);

    expect(await repository.listRates('company-1')).toMatchObject([
      { companyId: 'company-1', rateBasisPoints: 2550 },
      { companyId: 'company-1', rateBasisPoints: 0 },
    ]);
    expect(await repository.listRates('company-2')).toMatchObject([
      { companyId: 'company-2', rateBasisPoints: 1350 },
    ]);
    database.close();
  });

  it('removes obsolete rates in the same transaction', async () => {
    const database = new Database(':memory:');
    database.exec(migrationSql);
    const repository = new SqliteInvoiceVatRateRepository(database);

    await repository.replaceRates('company-1', [
      createStoredRate('company-1', 2550, true, 0),
      createStoredRate('company-1', 1350, false, 1),
    ]);
    await repository.replaceRates('company-1', [
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
    const repository = new SqliteInvoiceVatRateRepository(database);

    await repository.replaceRates('company-1', [
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
      repository.replaceRates('company-1', [
        createStoredRate('company-1', 1350, true, 0),
      ]),
    ).rejects.toThrow();

    expect(await repository.listRates('company-1')).toMatchObject([
      { rateBasisPoints: 2550 },
    ]);
    database.close();
  });
});

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
