import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import { readW6b2BusinessAmounts } from './w6b2PackagedWorkspaceBusinessFixture.js';
import type {
  W6b2PackagedWorkspaceFixture,
  W6b2PackagedWorkspaceFixtureKey,
} from './w6b2PackagedWorkspaceFixtures.js';
import { createW6b2PackagedWorkspaceRuntimeNamespaces } from './w6b2PackagedWorkspaceRuntimeNamespaces.js';

export async function createW6b2PackagedWorkspaceEvidenceTestFixture(
  workspaceRoot: string,
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Promise<Readonly<W6b2PackagedWorkspaceFixture>> {
  const fixture = {
    artifactRoot: workspaceRoot,
    businessArtifactPath: join(workspaceRoot, 'invoice.pdf'),
    databaseFilePath: join(workspaceRoot, 'workspace.sqlite'),
    profileId: 'a'.repeat(64),
    workspaceId: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
    workspaceRoot,
  };
  const pdf = Buffer.from(`%PDF-1.7\n% synthetic workspace ${fixtureKey}\n`);
  const business = {
    ...readW6b2BusinessAmounts(fixtureKey),
    companySettingsId: 'company-settings',
    customerId: 'customer',
    customerNumber: `W6B2-${fixtureKey}`,
    documentId: 'document',
    draftId: 'draft',
    draftLineId: 'draft-line',
    invoiceId: 'invoice',
    invoiceLineId: 'invoice-line',
    invoiceNumber: ({ A: '620001', B: '620002', C: '620003' } as const)[fixtureKey],
    pdfSha256: createHash('sha256').update(pdf).digest('hex'),
    pdfSize: pdf.byteLength,
  };
  await writeFile(fixture.businessArtifactPath, pdf);
  const database = new DatabaseSync(fixture.databaseFilePath);
  try {
    // Minimal evidence-reader model, not a schema-attested workspace.
    database.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (name TEXT PRIMARY KEY);
      CREATE TABLE schema_migration_metadata (
        migration_name TEXT PRIMARY KEY, source_sha256 TEXT NOT NULL,
        FOREIGN KEY (migration_name) REFERENCES schema_migrations(name)
      );
      INSERT INTO schema_migrations VALUES ('001_first.sql');
      CREATE TABLE company_settings (
        id TEXT PRIMARY KEY, company_id TEXT, company_name TEXT,
        business_id TEXT, default_hourly_rate_cents INTEGER
      );
      CREATE TABLE customers (
        id TEXT PRIMARY KEY, company_id TEXT, customer_number TEXT,
        name TEXT, status TEXT
      );
      CREATE TABLE invoice_drafts (
        id TEXT PRIMARY KEY, company_id TEXT, customer_id TEXT, status TEXT,
        subject TEXT, net_total_cents INTEGER, vat_total_cents INTEGER,
        gross_total_cents INTEGER
      );
      CREATE TABLE invoice_draft_lines (
        id TEXT PRIMARY KEY, invoice_draft_id TEXT, description TEXT,
        quantity_hundredths INTEGER, unit_price_cents INTEGER,
        base_cents INTEGER, net_cents INTEGER, vat_cents INTEGER, gross_cents INTEGER
      );
      CREATE TABLE invoices (
        id TEXT PRIMARY KEY, company_id TEXT, source_draft_id TEXT,
        invoice_number TEXT, status TEXT, customer_number_snapshot TEXT,
        total_net_cents INTEGER, total_vat_cents INTEGER, total_gross_cents INTEGER
      );
      CREATE TABLE invoice_lines (
        id TEXT PRIMARY KEY, invoice_id TEXT, description TEXT,
        quantity_hundredths INTEGER, unit_price_cents INTEGER,
        base_cents INTEGER, net_cents INTEGER, vat_cents INTEGER, gross_cents INTEGER
      );
      CREATE TABLE invoice_documents (
        id TEXT PRIMARY KEY, company_id TEXT, invoice_id TEXT,
        storage_path TEXT, sha256 TEXT, size_bytes INTEGER,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );
      CREATE TABLE invoice_payment_events (
        id TEXT PRIMARY KEY, company_id TEXT, invoice_id TEXT, actor_user_id TEXT,
        action TEXT, payment_source TEXT, paid_on TEXT,
        amount_cents INTEGER CHECK (amount_cents > 0), occurred_at TEXT,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id)
      );
    `);
    database.prepare('INSERT INTO schema_migration_metadata VALUES (?, ?)')
      .run('001_first.sql', 'a'.repeat(64));
    database.prepare('INSERT INTO company_settings VALUES (?, ?, ?, ?, ?)')
      .run(business.companySettingsId, 'company', 'Synthetic Company', '9999999-9', business.netCents);
    database.prepare('INSERT INTO customers VALUES (?, ?, ?, ?, ?)')
      .run(business.customerId, 'company', business.customerNumber, 'Synthetic Customer', 'active');
    database.prepare('INSERT INTO invoice_drafts VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(business.draftId, 'company', business.customerId, 'draft', 'Synthetic work',
        business.netCents, business.vatCents, business.grossCents);
    database.prepare('INSERT INTO invoice_draft_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(business.draftLineId, business.draftId, 'Synthetic work', 100,
        business.netCents, business.netCents, business.netCents, business.vatCents, business.grossCents);
    database.prepare('INSERT INTO invoices VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(business.invoiceId, 'company', business.draftId, business.invoiceNumber,
        'approved', business.customerNumber, business.netCents, business.vatCents, business.grossCents);
    database.prepare('INSERT INTO invoice_lines VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(business.invoiceLineId, business.invoiceId, 'Synthetic work', 100,
        business.netCents, business.netCents, business.netCents, business.vatCents, business.grossCents);
    database.prepare('INSERT INTO invoice_documents VALUES (?, ?, ?, ?, ?, ?)')
      .run(business.documentId, 'company', business.invoiceId, 'invoice.pdf',
        business.pdfSha256, business.pdfSize);
  } finally {
    database.close();
  }
  const namespaces = await createW6b2PackagedWorkspaceRuntimeNamespaces({
    business, fixture, fixtureKey,
  });
  return { ...fixture, ...namespaces, business, fixtureKey };
}

export function mutateW6b2EvidenceTestDatabase(
  databaseFilePath: string,
  mutate: (database: DatabaseSync) => void,
): void {
  const database = new DatabaseSync(databaseFilePath);
  try {
    database.exec('PRAGMA foreign_keys = OFF;');
    mutate(database);
  } finally {
    database.close();
  }
}
