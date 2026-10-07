import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, toNamespacedPath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { readMigrationManifest } from '../../../backend/src/database/migration/migrationManifest.ts';
import { prepareMigrationHistoryForRun, recordAppliedMigrationMetadata } from '../../../backend/src/database/migration/migrationMetadata.ts';
import { snapshotLegacyDatabaseSchema } from './legacyUpgradeDatabaseEvidence.mjs';

export const SOURCE_DATABASE_IDENTITY = Object.freeze({ appVersion: '0.2.6', buildRevision: 'a'.repeat(12) });
export const TARGET_DATABASE_IDENTITY = Object.freeze({ appVersion: '0.2.7', buildRevision: 'b'.repeat(12) });
const migrationRoot = fileURLToPath(new URL('../../../backend/src/database/migrations/', import.meta.url));
const timestamp = '2026-09-04T08:00:00.000Z';

function transaction(database, operation) {
  database.exec('BEGIN');
  try { operation(); database.exec('COMMIT'); }
  catch (error) { database.exec('ROLLBACK'); throw error; }
}

export function applyLegacyFixtureMigrations(database, manifest, identity) {
  // The fixture adapts only the transaction call used by the existing metadata owner.
  database.transaction = operation => () => transaction(database, operation);
  const applied = prepareMigrationHistoryForRun(database, manifest, identity, timestamp);
  for (const entry of manifest) {
    if (applied.has(entry.fileName)) continue;
    transaction(database, () => {
      database.exec(entry.content.toString('utf8'));
      database.prepare('INSERT INTO schema_migrations(name,run_at) VALUES (?,?)').run(entry.fileName, timestamp);
      recordAppliedMigrationMetadata(database, { entry, releaseIdentity: identity, recordedAt: timestamp });
    });
  }
}

export function generateLegacyDatabaseContract() {
  const manifest = readMigrationManifest(migrationRoot);
  assert.equal(manifest.length, 39);
  const database = new DatabaseSync(':memory:');
  try {
    database.exec('PRAGMA foreign_keys = ON');
    applyLegacyFixtureMigrations(database, manifest.slice(0, 38), SOURCE_DATABASE_IDENTITY);
    const sourceSchema = snapshotLegacyDatabaseSchema(database);
    applyLegacyFixtureMigrations(database, manifest, TARGET_DATABASE_IDENTITY);
    const targetSchema = snapshotLegacyDatabaseSchema(database);
    const invoiceColumns = sourceSchema.find(object => object.name === 'invoices').columns.map(column => column.name);
    const revisionCopyFields = targetSchema.find(object => object.name === 'invoice_content_revisions').columns
      .map(column => column.name).filter(name => !['id', 'company_id'].includes(name) && invoiceColumns.includes(name));
    assert.equal(revisionCopyFields.length, 64);
    return { schemaVersion: 1, migrations: manifest.map(({ fileName, sourceSha256, chainSha256 }) =>
      ({ fileName, sourceSha256, chainSha256 })), sourceSchema, targetSchema, revisionCopyFields };
  } finally { database.close(); }
}

export async function createLegacyDatabasePackageFixture(installRoot) {
  const sqlRoot = resolve(installRoot, 'resources/backend/dist/database/migrations');
  const appRoot = resolve(installRoot, 'resources/app/dist');
  await mkdir(sqlRoot, { recursive: true });
  await mkdir(appRoot, { recursive: true });
  for (const entry of readMigrationManifest(migrationRoot)) {
    await writeFile(resolve(sqlRoot, entry.fileName), entry.content, { flag: 'wx' });
  }
  await writeFile(resolve(appRoot, 'build-info.json'), JSON.stringify({ ...TARGET_DATABASE_IDENTITY,
    schemaVersion: 1, buildDirty: false, buildCreatedAt: timestamp }), { flag: 'wx' });
}

function insertFixtureRow(database, table, overrides) {
  const columns = database.prepare(`PRAGMA table_info("${table}")`).all();
  const values = Object.fromEntries(columns.filter(column => column.notnull && column.dflt_value === null)
    .map(column => [column.name, column.type === 'INTEGER' ? 0 : 'synthetic']));
  Object.assign(values, overrides);
  const names = Object.keys(values);
  database.prepare(`INSERT INTO "${table}" (${names.map(name => `"${name}"`).join(',')}) VALUES (${names.map(() => '?').join(',')})`)
    .run(...names.map(name => values[name]));
}

function seedLegacyFixture(database, pdf) {
  const invoice = { company_id: 'synthetic-company', invoice_kind: 'standard',
    credited_invoice_id: null, status: 'sent', customer_id: 'customer-one', customer_type_snapshot: 'company',
    billing_recipient_customer_type_snapshot: 'company', invoice_date: '2026-09-04', due_date: '2026-09-18',
    price_input_mode: 'net', tax_treatment: 'normalVat', tax_treatment_label_snapshot: '', tax_legal_basis_snapshot: '',
    reference_number: null, reference_number_type: null, series_key: 'default', sequence_scope: 'calendar-year:2026',
    numbering_mode: 'calendarYearSequence', total_net_cents: 100, total_vat_cents: 25, total_gross_cents: 125,
    created_at: timestamp, approved_at: timestamp, updated_at: timestamp };
  for (const [id, sequence_number, status, invoice_kind, credited_invoice_id, company_id] of [
    ['invoice-one', 1, 'sent', 'standard', null, 'synthetic-company'],
    ['invoice-reopened', 2, 'reopened_for_edit', 'standard', null, 'synthetic-company'],
    ['invoice-credit', 3, 'approved', 'credit', 'invoice-one', 'synthetic-company'],
    ['invoice-foreign', 4, 'approved', 'standard', null, 'foreign-company'],
  ]) {
    const source_draft_id = `draft-${id}`;
    insertFixtureRow(database, 'invoice_drafts', { id: source_draft_id, company_id, customer_id: 'customer-one',
      status: 'draft', invoice_kind, invoice_date: '2026-09-04', due_date: '2026-09-18', price_input_mode: 'net' });
    insertFixtureRow(database, 'invoices', { ...invoice, id, sequence_number, invoice_number: `2026000${sequence_number}`,
      source_draft_id, status, invoice_kind, credited_invoice_id, company_id });
  }
  const line = { line_order: 1, code: 'SYNTHETIC', description: 'Synthetic item', quantity_hundredths: 100,
    unit: 'h', unit_price_cents: 100, vat_rate_basis_points: 2500, discount_type: 'none', discount_value: 0,
    base_cents: 100, discount_cents: 0, net_cents: 100, vat_cents: 25, gross_cents: 125, created_at: timestamp };
  insertFixtureRow(database, 'invoice_lines', { ...line, id: 'line-one', invoice_id: 'invoice-one', source_invoice_line_id: null });
  insertFixtureRow(database, 'invoice_lines', { ...line, id: 'line-credit', invoice_id: 'invoice-credit', source_invoice_line_id: 'line-one' });
  insertFixtureRow(database, 'invoice_documents', { id: 'document-one', company_id: 'synthetic-company', invoice_id: 'invoice-one',
    document_type: 'approved_invoice_pdf', file_name: 'approved-invoice.pdf', storage_path: 'invoices/one/approved-invoice.pdf',
    mime_type: 'application/pdf', sha256: createHash('sha256').update(pdf).digest('hex'), size_bytes: pdf.length, created_at: timestamp });
  insertFixtureRow(database, 'invoice_delivery_events', { id: 'event-one', company_id: 'synthetic-company', invoice_id: 'invoice-one',
    document_id: 'document-one', delivery_method: 'email', provider: 'smtp', status: 'outcomeUnknown', created_at: timestamp });
}

export async function createLegacyDatabaseFixture(root, { longPath = false, targetCount = 39 } = {}) {
  const sourceRoot = resolve(root, 'source');
  const targetRoot = longPath ? resolve(root, ...Array.from({ length: 12 }, (_, index) => `long-synthetic-component-${index}`), 'target') : resolve(root, 'target');
  const paths = { sourceDataRoot: resolve(sourceRoot, 'data'), sourceStorageRoot: resolve(sourceRoot, 'storage'),
    targetDataRoot: resolve(targetRoot, 'data'), targetStorageRoot: resolve(targetRoot, 'storage') };
  for (const directory of Object.values(paths)) await mkdir(directory, { recursive: true });
  const pdf = Buffer.from('%PDF-synthetic-approved-invoice');
  const relativePdf = 'invoices/one/approved-invoice.pdf';
  for (const storage of [paths.sourceStorageRoot, paths.targetStorageRoot]) {
    await mkdir(resolve(storage, 'invoices', 'one'), { recursive: true });
    await writeFile(resolve(storage, relativePdf), pdf);
  }
  const manifest = readMigrationManifest(migrationRoot);
  let database = new DatabaseSync(toNamespacedPath(resolve(paths.sourceDataRoot, 'eky.sqlite')));
  try {
    database.exec('PRAGMA foreign_keys = ON');
    applyLegacyFixtureMigrations(database, manifest.slice(0, 38), SOURCE_DATABASE_IDENTITY);
    seedLegacyFixture(database, pdf);
  } finally { database.close(); }
  await copyFile(resolve(paths.sourceDataRoot, 'eky.sqlite'), resolve(paths.targetDataRoot, 'eky.sqlite'));
  if (targetCount === 39) {
    database = new DatabaseSync(toNamespacedPath(resolve(paths.targetDataRoot, 'eky.sqlite')));
    try {
      database.exec('PRAGMA foreign_keys = ON');
      applyLegacyFixtureMigrations(database, manifest, TARGET_DATABASE_IDENTITY);
    } finally { database.close(); }
  }
  return paths;
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--write-contract') {
  await writeFile(new URL('./legacyUpgradeDatabase038To039.contract.json', import.meta.url),
    `${JSON.stringify(generateLegacyDatabaseContract(), null, 2)}\n`, { flag: 'wx' });
}
