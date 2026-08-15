import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import { createInvoiceReadModelTestDatabase } from '../../../testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteInvoiceIssuanceReadinessReader } from './sqliteInvoiceIssuanceReadinessReader.js';

describe('SqliteInvoiceIssuanceReadinessReader', () => {
  let database: DatabaseConnection;
  let reader: SqliteInvoiceIssuanceReadinessReader;

  beforeEach(async () => {
    database = await createInvoiceReadModelTestDatabase();
    reader = new SqliteInvoiceIssuanceReadinessReader(database);
    insertCustomer(database);
    insertCompanySettings(database);
    insertInvoiceNumberingSettings(database);
  });

  afterEach(() => database.close());

  it('returns only the data needed by the issuance readiness rule', async () => {
    await expect(
      reader.getReadinessData('dev-company', 'draft-1'),
    ).resolves.toEqual({
      billingRecipientCity: 'Helsinki',
      billingRecipientName: 'Test Customer Oy',
      billingRecipientPostalCode: '00100',
      billingRecipientStreetAddress: 'Customer Street 1',
      companyBusinessId: '7654321-0',
      companyCity: 'Tampere',
      companyIban: 'FI2112345600000785',
      companyName: 'Example Builder Oy',
      companyPostalCode: '33100',
      companyStreetAddress: 'Builder Street 2',
      companyVatNumber: 'FI76543210',
      customerCity: 'Helsinki',
      customerName: 'Test Customer Oy',
      customerPostalCode: '00100',
      customerStreetAddress: 'Customer Street 1',
      hasActiveInvoiceNumberingSettings: true,
    });
  });

  it('does not reveal a draft outside its company scope', async () => {
    await expect(
      reader.getReadinessData('other-company', 'draft-1'),
    ).resolves.toBeUndefined();
  });

  it('returns empty values for missing linked master data', async () => {
    database.prepare("DELETE FROM company_settings").run();
    database.prepare("DELETE FROM customers").run();

    await expect(
      reader.getReadinessData('dev-company', 'draft-1'),
    ).resolves.toMatchObject({
      billingRecipientName: '',
      companyName: '',
      customerName: '',
      hasActiveInvoiceNumberingSettings: true,
    });
  });

  it('reports that active invoice numbering settings are missing', async () => {
    database.close();
    database = await createInvoiceReadModelTestDatabase();
    reader = new SqliteInvoiceIssuanceReadinessReader(database);
    insertCustomer(database);
    insertCompanySettings(database);

    await expect(
      reader.getReadinessData('dev-company', 'draft-1'),
    ).resolves.toMatchObject({
      hasActiveInvoiceNumberingSettings: false,
    });
  });
});

function insertCustomer(database: DatabaseConnection): void {
  database.prepare(`
    INSERT INTO customers (
      id, company_id, name, created_at, updated_at, customer_number,
      customer_type, business_id, street_address, postal_code, city, email,
      phone, comment, status, managed_by_customer_id,
      hourly_rate_override_cents
    ) VALUES (
      'customer-1', 'dev-company', 'Test Customer Oy', 'created', 'updated',
      '1001', 'company', '1234567-8', 'Customer Street 1', '00100',
      'Helsinki', 'customer@example.fi', '040 111 2222', '', 'active', '', NULL
    )
  `).run();
}

function insertCompanySettings(database: DatabaseConnection): void {
  database.prepare(`
    INSERT INTO company_settings (
      id, company_id, company_name, business_id, vat_number, street_address,
      postal_code, city, email, phone, iban, bic, bank_name,
      default_hourly_rate_cents, created_at, updated_at, hourly_rate_shortcut
    ) VALUES (
      'settings-1', 'dev-company', 'Example Builder Oy', '7654321-0',
      'FI76543210', 'Builder Street 2', '33100', 'Tampere',
      'billing@example.fi', '03 123 4567', 'FI2112345600000785', 'NDEAFIHH',
      'Example Bank', 6500, 'created', 'updated', 'työ'
    )
  `).run();
}

function insertInvoiceNumberingSettings(database: DatabaseConnection): void {
  database.prepare(`
    INSERT INTO invoice_numbering_settings (
      company_id, series_key, mode, fiscal_year_start_month,
      sequence_padding, first_sequence_number, created_at, updated_at
    ) VALUES (
      'dev-company', 'default', 'calendarYearSequence', 1,
      4, 1, 'created', 'updated'
    )
  `).run();
  database.prepare(`
    INSERT INTO invoice_numbering_active_series (
      company_id, active_series_key, revision, updated_at, updated_by
    ) VALUES (
      'dev-company', 'default', 1, 'updated', 'test-actor'
    )
  `).run();
}
