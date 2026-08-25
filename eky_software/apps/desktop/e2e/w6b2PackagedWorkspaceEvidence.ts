import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import type { W6b2PackagedWorkspaceFixture } from './w6b2PackagedWorkspaceFixtures.js';

export interface W6b2PackagedWorkspaceFileEvidence {
  readonly sha256: string;
  readonly size: number;
}

export interface W6b2PackagedWorkspaceEvidence {
  readonly archiveConfig: Readonly<W6b2PackagedWorkspaceFileEvidence>;
  readonly archiveJournal: Readonly<W6b2PackagedWorkspaceFileEvidence>;
  readonly archiveSentinel: Readonly<W6b2PackagedWorkspaceFileEvidence>;
  readonly businessRowsSha256: string;
  readonly database: Readonly<W6b2PackagedWorkspaceFileEvidence>;
  readonly pdf: Readonly<W6b2PackagedWorkspaceFileEvidence>;
  readonly recoverySentinel: Readonly<W6b2PackagedWorkspaceFileEvidence>;
  readonly secretSentinel: Readonly<W6b2PackagedWorkspaceFileEvidence>;
}

export async function snapshotW6b2PackagedWorkspaceEvidence(
  fixture: Readonly<W6b2PackagedWorkspaceFixture>,
): Promise<Readonly<W6b2PackagedWorkspaceEvidence>> {
  const businessRowsSha256 = snapshotBusinessRows(fixture);
  const [
    archiveConfig,
    archiveJournal,
    archiveSentinel,
    database,
    pdf,
    recoverySentinel,
    secretSentinel,
  ] = await Promise.all([
    snapshotFile(fixture.archiveConfigFilePath),
    snapshotFile(fixture.archiveJournalFilePath),
    snapshotFile(fixture.archiveSentinelFilePath),
    snapshotFile(fixture.databaseFilePath),
    snapshotFile(fixture.businessArtifactPath),
    snapshotFile(fixture.recoverySentinelFilePath),
    snapshotFile(fixture.secretSentinelFilePath),
  ]);
  if (
    pdf.sha256 !== fixture.business.pdfSha256 ||
    pdf.size !== fixture.business.pdfSize
  ) {
    throw new Error('W6B2_EVIDENCE_PDF_INVALID');
  }

  return Object.freeze({
    archiveConfig,
    archiveJournal,
    archiveSentinel,
    businessRowsSha256,
    database,
    pdf,
    recoverySentinel,
    secretSentinel,
  });
}

export function w6b2PackagedWorkspaceContentPreserved(
  before: Readonly<W6b2PackagedWorkspaceEvidence>,
  after: Readonly<W6b2PackagedWorkspaceEvidence>,
): boolean {
  return (
    before.archiveConfig.sha256 === after.archiveConfig.sha256 &&
    before.archiveJournal.sha256 === after.archiveJournal.sha256 &&
    before.archiveSentinel.sha256 === after.archiveSentinel.sha256 &&
    before.businessRowsSha256 === after.businessRowsSha256 &&
    before.pdf.sha256 === after.pdf.sha256 &&
    before.pdf.size === after.pdf.size &&
    before.recoverySentinel.sha256 === after.recoverySentinel.sha256 &&
    before.secretSentinel.sha256 === after.secretSentinel.sha256
  );
}

function snapshotBusinessRows(
  fixture: Readonly<W6b2PackagedWorkspaceFixture>,
): string {
  const database = new DatabaseSync(fixture.databaseFilePath, {
    open: true,
    readOnly: true,
  });
  try {
    requireHealthyDatabase(database);
    const rows = [
      requireRow(
        database,
        `
          SELECT id, company_id, company_name, business_id,
                 default_hourly_rate_cents
          FROM company_settings WHERE id = ?
        `,
        fixture.business.companySettingsId,
      ),
      requireRow(
        database,
        `
          SELECT id, company_id, customer_number, name, status
          FROM customers WHERE id = ?
        `,
        fixture.business.customerId,
      ),
      requireRow(
        database,
        `
          SELECT id, company_id, customer_id, status, subject,
                 net_total_cents, vat_total_cents, gross_total_cents
          FROM invoice_drafts WHERE id = ?
        `,
        fixture.business.draftId,
      ),
      requireRow(
        database,
        `
          SELECT id, invoice_draft_id, description, quantity_hundredths,
                 unit_price_cents, base_cents, net_cents, vat_cents,
                 gross_cents
          FROM invoice_draft_lines WHERE id = ?
        `,
        fixture.business.draftLineId,
      ),
      requireRow(
        database,
        `
          SELECT id, company_id, source_draft_id, invoice_number, status,
                 customer_number_snapshot, total_net_cents,
                 total_vat_cents, total_gross_cents
          FROM invoices WHERE id = ?
        `,
        fixture.business.invoiceId,
      ),
      requireRow(
        database,
        `
          SELECT id, invoice_id, description, quantity_hundredths,
                 unit_price_cents, base_cents, net_cents, vat_cents,
                 gross_cents
          FROM invoice_lines WHERE id = ?
        `,
        fixture.business.invoiceLineId,
      ),
      requireRow(
        database,
        `
          SELECT id, company_id, invoice_id, storage_path, sha256, size_bytes
          FROM invoice_documents WHERE id = ?
        `,
        fixture.business.documentId,
      ),
    ] as const;
    requireBusinessIdentityAndTotals(rows, fixture);
    return createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex');
  } finally {
    database.close();
  }
}

function requireBusinessIdentityAndTotals(
  rows: readonly Readonly<Record<string, unknown>>[],
  fixture: Readonly<W6b2PackagedWorkspaceFixture>,
): void {
  const [company, customer, draft, draftLine, invoice, invoiceLine, document] =
    rows;
  const business = fixture.business;
  if (
    company?.id !== business.companySettingsId ||
    customer?.id !== business.customerId ||
    customer.customer_number !== business.customerNumber ||
    draft?.id !== business.draftId ||
    draftLine?.id !== business.draftLineId ||
    invoice?.id !== business.invoiceId ||
    invoice.invoice_number !== business.invoiceNumber ||
    invoiceLine?.id !== business.invoiceLineId ||
    document?.id !== business.documentId ||
    document.sha256 !== business.pdfSha256 ||
    Number(document.size_bytes) !== business.pdfSize ||
    !totalsMatch(draft, 'net_total_cents', 'vat_total_cents', 'gross_total_cents', business) ||
    !totalsMatch(draftLine, 'net_cents', 'vat_cents', 'gross_cents', business) ||
    !totalsMatch(invoice, 'total_net_cents', 'total_vat_cents', 'total_gross_cents', business) ||
    !totalsMatch(invoiceLine, 'net_cents', 'vat_cents', 'gross_cents', business)
  ) {
    throw new Error('W6B2_EVIDENCE_BUSINESS_INVALID');
  }
}

function totalsMatch(
  row: Readonly<Record<string, unknown>>,
  netKey: string,
  vatKey: string,
  grossKey: string,
  expected: Readonly<{
    grossCents: number;
    netCents: number;
    vatCents: number;
  }>,
): boolean {
  return (
    Number(row[netKey]) === expected.netCents &&
    Number(row[vatKey]) === expected.vatCents &&
    Number(row[grossKey]) === expected.grossCents
  );
}

function requireRow(
  database: DatabaseSync,
  sql: string,
  id: string,
): Readonly<Record<string, unknown>> {
  const row = database.prepare(sql).get(id) as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) {
    throw new Error('W6B2_EVIDENCE_BUSINESS_INVALID');
  }
  return row;
}

function requireHealthyDatabase(database: DatabaseSync): void {
  const integrityRows = database
    .prepare('PRAGMA integrity_check;')
    .all() as readonly Record<string, unknown>[];
  const integrityResult = integrityRows[0]
    ? Object.values(integrityRows[0])[0]
    : undefined;
  if (
    integrityRows.length !== 1 ||
    integrityResult !== 'ok' ||
    database.prepare('PRAGMA foreign_key_check;').all().length !== 0
  ) {
    throw new Error('W6B2_EVIDENCE_SQLITE_INVALID');
  }
}

async function snapshotFile(
  path: string,
): Promise<Readonly<W6b2PackagedWorkspaceFileEvidence>> {
  const metadata = await stat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1) {
    throw new Error('W6B2_EVIDENCE_FILE_INVALID');
  }
  const bytes = await readFile(path);
  return Object.freeze({
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: metadata.size,
  });
}
