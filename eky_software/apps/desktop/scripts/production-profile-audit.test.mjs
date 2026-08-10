import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, test } from 'node:test';

import { createProductionProfileAudit } from './production-profile-audit.mjs';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

test('audits only a copied healthy profile and returns safe aggregate fields', async () => {
  const fixture = await createProfileFixture({ synthetic: true });
  const report = await createProductionProfileAudit(fixture);

  assert.equal(report.classification, 'synthetic/test-data-present');
  assert.equal(report.integrityCheck, 'ok');
  assert.equal(report.foreignKeyCheck, 'ok');
  assert.equal(report.migrationChainMatches, true);
  assert.equal(report.localRuntimeIdentitySingletonCount, 1);
  assert.equal(report.distinctCompanyIdCount, 1);
  assert.equal(report.customerRowCount, 1);
  assert.equal(report.authoritativePdfCount, 1);
  assert.equal(report.missingReferencedPdfCount, 0);
  assert.equal(report.orphanPdfCount, 0);
  assert.equal(report.pdfHashSizeClosure, 'valid');
  assert.doesNotMatch(
    JSON.stringify(report),
    /Test Customer|example\.fi|company-1|approved-invoice\.pdf/,
  );
});

test('reports invalid PDF closure without exposing the affected path', async () => {
  const fixture = await createProfileFixture({ omitPdf: true, synthetic: true });
  const report = await createProductionProfileAudit(fixture);

  assert.equal(report.classification, 'unhealthy');
  assert.equal(report.missingReferencedPdfCount, 1);
  assert.equal(report.pdfHashSizeClosure, 'invalid');
  assert.doesNotMatch(JSON.stringify(report), /company-1|approved-invoice/);
});

test('classifies a migrated identity-only profile as clean and empty', async () => {
  const fixture = await createProfileFixture({ empty: true });
  const report = await createProductionProfileAudit(fixture);

  assert.equal(report.classification, 'clean-empty');
  assert.equal(report.localRuntimeIdentitySingletonCount, 1);
  assert.equal(report.distinctCompanyIdCount, 1);
  assert.equal(report.companySettingsConfigured, false);
  assert.equal(report.customerRowCount, 0);
  assert.equal(report.authoritativePdfCount, 0);
  assert.equal(report.pdfHashSizeClosure, 'valid');
});

async function createProfileFixture({
  empty = false,
  omitPdf = false,
  synthetic = false,
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'eky-production-profile-audit-test-'));
  temporaryDirectories.push(root);
  const profileRoot = join(root, 'profile');
  const migrationsDirectory = join(root, 'migrations');
  const databasePath = join(profileRoot, 'runtime', 'data', 'eky.sqlite');
  await mkdir(join(profileRoot, 'runtime', 'data'), { recursive: true });
  await mkdir(migrationsDirectory, { recursive: true });
  const migrationName = '001_synthetic.sql';
  await writeFile(join(migrationsDirectory, migrationName), 'SELECT 1;\n', 'utf8');

  const pdf = Buffer.from('%PDF-1.4\nsynthetic\n', 'ascii');
  const pdfStoragePath = 'company-1/invoice-1/approved-invoice.pdf';
  if (!empty && !omitPdf) {
    const pdfPath = join(
      profileRoot,
      'runtime',
      'storage',
      'invoices',
      ...pdfStoragePath.split('/'),
    );
    await mkdir(dirname(pdfPath), { recursive: true });
    await writeFile(pdfPath, pdf);
  }

  const database = new DatabaseSync(databasePath);
  database.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, run_at TEXT NOT NULL);
    CREATE TABLE local_runtime_identity (
      singleton_key TEXT PRIMARY KEY,
      installation_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE company_settings (company_id TEXT, company_name TEXT, email TEXT);
    CREATE TABLE customers (
      company_id TEXT,
      name TEXT,
      email TEXT,
      comment TEXT
    );
    CREATE TABLE invoice_drafts (company_id TEXT, subject TEXT, note TEXT);
    CREATE TABLE invoice_numbering_settings (company_id TEXT);
    CREATE TABLE invoice_number_sequences (company_id TEXT);
    CREATE TABLE invoice_payment_settings (company_id TEXT);
    CREATE TABLE invoice_vat_rates (company_id TEXT);
    CREATE TABLE invoices (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      status TEXT,
      invoice_kind TEXT,
      customer_name_snapshot TEXT,
      subject TEXT,
      note TEXT
    );
    CREATE TABLE invoice_documents (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      invoice_id TEXT,
      storage_path TEXT,
      sha256 TEXT,
      size_bytes INTEGER,
      FOREIGN KEY (invoice_id) REFERENCES invoices(id)
    );
    CREATE TABLE invoice_delivery_events (company_id TEXT);
    CREATE TABLE invoice_payment_events (company_id TEXT);
    CREATE TABLE invoice_audit_events (company_id TEXT);
    CREATE TABLE company_email_secret_audit_events (company_id TEXT);
    CREATE TABLE customer_audit_events (company_id TEXT);
    CREATE TABLE company_settings_audit_events (company_id TEXT);
    CREATE TABLE invoice_settings_audit_events (company_id TEXT);
  `);
  const companyId = synthetic ? 'dev-company' : 'company-1';
  database
    .prepare('INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)')
    .run(migrationName, '2026-08-10T00:00:00.000Z');
  database
    .prepare(
      `INSERT INTO local_runtime_identity VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      'local-runtime',
      'a'.repeat(32),
      companyId,
      'local-owner',
      '2026-08-10T00:00:00.000Z',
    );
  if (!empty) {
    database
      .prepare('INSERT INTO company_settings VALUES (?, ?, ?)')
      .run(
        companyId,
        synthetic ? 'Test Company' : 'Pilot Company',
        synthetic ? 'test@example.fi' : 'billing@pilot.invalid',
      );
    database
      .prepare('INSERT INTO customers VALUES (?, ?, ?, ?)')
      .run(
        companyId,
        synthetic ? 'Test Customer' : 'Pilot Customer',
        synthetic ? 'customer@example.fi' : 'customer@pilot.invalid',
        '',
      );
    database
      .prepare('INSERT INTO invoices VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        'invoice-1',
        companyId,
        'approved',
        'standard',
        synthetic ? 'Test Customer' : 'Pilot Customer',
        synthetic ? 'Test invoice' : 'Pilot invoice',
        '',
      );
    database
      .prepare('INSERT INTO invoice_documents VALUES (?, ?, ?, ?, ?, ?)')
      .run(
        'document-1',
        companyId,
        'invoice-1',
        pdfStoragePath,
        createHash('sha256').update(pdf).digest('hex'),
        pdf.byteLength,
      );
  }
  database.close();

  return { migrationsDirectory, profileRoot };
}
