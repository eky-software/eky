import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import type { WorkspaceFirstStartProofFixture } from './workspaceFirstStartMigrationProofFixtures.js';

export type W6b2PackagedWorkspaceFixtureKey = 'A' | 'B' | 'C';

export interface W6b2PackagedWorkspaceBusinessFixture {
  readonly companySettingsId: string;
  readonly customerId: string;
  readonly customerNumber: string;
  readonly documentId: string;
  readonly draftId: string;
  readonly draftLineId: string;
  readonly grossCents: number;
  readonly invoiceId: string;
  readonly invoiceLineId: string;
  readonly invoiceNumber: string;
  readonly netCents: number;
  readonly pdfSha256: string;
  readonly pdfSize: number;
  readonly vatCents: number;
}

interface W6b2BusinessAmounts {
  readonly grossCents: number;
  readonly netCents: number;
  readonly vatCents: number;
}

interface W6b2BusinessFixtureIdentity {
  readonly companySettingsId: string;
  readonly customerNumber: string;
  readonly invoiceNumber: string;
}

const businessIds = Object.freeze({
  auditId: 'workspace-proof-audit',
  customerId: 'workspace-proof-customer',
  documentId: 'workspace-proof-document',
  draftId: 'workspace-proof-draft',
  draftLineId: 'workspace-proof-draft-line',
  invoiceId: 'workspace-proof-invoice',
  invoiceLineId: 'workspace-proof-invoice-line',
});

export async function customizeW6b2PackagedWorkspaceBusinessFixture(
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Promise<Readonly<W6b2PackagedWorkspaceBusinessFixture>> {
  const amounts = readW6b2BusinessAmounts(fixtureKey);
  const identity = createBusinessFixtureIdentity(fixtureKey);
  const pdfBytes = Buffer.from(
    `%PDF-1.7\n% Eky synthetic W6B2 workspace ${fixtureKey}\n`,
    'utf8',
  );
  const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');
  await writeFile(fixture.businessArtifactPath, pdfBytes, { mode: 0o600 });

  const database = new DatabaseSync(fixture.databaseFilePath);
  let transactionStarted = false;
  try {
    database.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
    transactionStarted = true;
    const companyId = readCompanyId(database);
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE customers
            SET name = ?, customer_number = ?
            WHERE id = ?
          `,
        )
        .run(
          `Synthetic Workspace Customer ${fixtureKey}`,
          identity.customerNumber,
          businessIds.customerId,
        ),
    );
    database
      .prepare(
        `
          INSERT INTO company_settings (
            id,
            company_id,
            company_name,
            business_id,
            street_address,
            postal_code,
            city,
            email,
            phone,
            default_hourly_rate_cents,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        identity.companySettingsId,
        companyId,
        `Synthetic Company ${fixtureKey}`,
        `99999${fixtureNumber(fixtureKey)}-${fixtureNumber(fixtureKey)}`,
        `Synthetic Street ${fixtureNumber(fixtureKey)}`,
        `00${String(fixtureNumber(fixtureKey)).padStart(3, '0')}`,
        `Synthetic City ${fixtureKey}`,
        `workspace-${fixtureKey.toLowerCase()}@example.invalid`,
        `00000000${fixtureNumber(fixtureKey)}`,
        amounts.netCents,
        '2026-08-22T00:00:00.000Z',
        '2026-08-22T00:00:00.000Z',
      );
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE invoice_drafts
            SET subject = ?, net_total_cents = ?, vat_total_cents = ?,
                gross_total_cents = ?
            WHERE id = ?
          `,
        )
        .run(
          `Synthetic workspace ${fixtureKey} proof`,
          amounts.netCents,
          amounts.vatCents,
          amounts.grossCents,
          businessIds.draftId,
        ),
    );
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE invoice_draft_lines
            SET description = ?, unit_price_cents = ?, base_cents = ?,
                net_cents = ?, vat_cents = ?, gross_cents = ?
            WHERE id = ?
          `,
        )
        .run(
          `Synthetic migration-safe work ${fixtureKey}`,
          amounts.netCents,
          amounts.netCents,
          amounts.netCents,
          amounts.vatCents,
          amounts.grossCents,
          businessIds.draftLineId,
        ),
    );
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE invoices
            SET invoice_number = ?, customer_number_snapshot = ?,
                customer_name_snapshot = ?, subject = ?, total_net_cents = ?,
                total_vat_cents = ?, total_gross_cents = ?
            WHERE id = ?
          `,
        )
        .run(
          identity.invoiceNumber,
          identity.customerNumber,
          `Synthetic Workspace Customer ${fixtureKey}`,
          `Synthetic workspace ${fixtureKey} proof`,
          amounts.netCents,
          amounts.vatCents,
          amounts.grossCents,
          businessIds.invoiceId,
        ),
    );
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE invoice_lines
            SET description = ?, unit_price_cents = ?, base_cents = ?,
                net_cents = ?, vat_cents = ?, gross_cents = ?
            WHERE id = ?
          `,
        )
        .run(
          `Synthetic migration-safe work ${fixtureKey}`,
          amounts.netCents,
          amounts.netCents,
          amounts.netCents,
          amounts.vatCents,
          amounts.grossCents,
          businessIds.invoiceLineId,
        ),
    );
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE invoice_documents
            SET sha256 = ?, size_bytes = ?
            WHERE id = ?
          `,
        )
        .run(pdfSha256, pdfBytes.byteLength, businessIds.documentId),
    );
    requireChangedRow(
      database
        .prepare(
          `
            UPDATE invoice_audit_events
            SET invoice_number = ?
            WHERE id = ?
          `,
        )
        .run(identity.invoiceNumber, businessIds.auditId),
    );
    requireConsistentBusinessTotals(database, amounts);
    requireHealthySqliteDatabase(database);
    database.exec('COMMIT;');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) database.exec('ROLLBACK;');
    throw error;
  } finally {
    database.close();
  }

  return Object.freeze({
    companySettingsId: identity.companySettingsId,
    customerId: businessIds.customerId,
    customerNumber: identity.customerNumber,
    documentId: businessIds.documentId,
    draftId: businessIds.draftId,
    draftLineId: businessIds.draftLineId,
    grossCents: amounts.grossCents,
    invoiceId: businessIds.invoiceId,
    invoiceLineId: businessIds.invoiceLineId,
    invoiceNumber: identity.invoiceNumber,
    netCents: amounts.netCents,
    pdfSha256,
    pdfSize: pdfBytes.byteLength,
    vatCents: amounts.vatCents,
  });
}

export function readW6b2BusinessAmounts(
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Readonly<W6b2BusinessAmounts> {
  const netCents = fixtureNumber(fixtureKey) * 10_000;
  const vatCents = Math.round((netCents * 2_550) / 10_000);
  return Object.freeze({
    grossCents: netCents + vatCents,
    netCents,
    vatCents,
  });
}

function createBusinessFixtureIdentity(
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Readonly<W6b2BusinessFixtureIdentity> {
  const number = fixtureNumber(fixtureKey);
  return Object.freeze({
    companySettingsId: `w6b2-${fixtureKey.toLowerCase()}-company-settings`,
    customerNumber: `W6B2-${number}`,
    invoiceNumber: `62000${number}`,
  });
}

function fixtureNumber(fixtureKey: W6b2PackagedWorkspaceFixtureKey): number {
  switch (fixtureKey) {
    case 'A':
      return 1;
    case 'B':
      return 2;
    case 'C':
      return 3;
  }
}

function readCompanyId(database: DatabaseSync): string {
  const row = database
    .prepare(
      `
        SELECT company_id
        FROM local_runtime_identity
        WHERE singleton_key = 'local-runtime'
      `,
    )
    .get() as { company_id?: unknown } | undefined;
  if (
    typeof row?.company_id !== 'string' ||
    !/^[A-Za-z0-9_-]{1,120}$/u.test(row.company_id)
  ) {
    throw new Error('W6B2_COMPANY_ID_INVALID');
  }
  return row.company_id;
}

function requireChangedRow(result: { readonly changes: number | bigint }): void {
  if (Number(result.changes) !== 1) {
    throw new Error('W6B2_BUSINESS_FIXTURE_ROW_MISSING');
  }
}

function requireConsistentBusinessTotals(
  database: DatabaseSync,
  expected: Readonly<W6b2BusinessAmounts>,
): void {
  const rows = [
    database
      .prepare(
        `
          SELECT net_total_cents AS net, vat_total_cents AS vat,
                 gross_total_cents AS gross
          FROM invoice_drafts WHERE id = ?
        `,
      )
      .get(businessIds.draftId),
    database
      .prepare(
        `
          SELECT net_cents AS net, vat_cents AS vat, gross_cents AS gross
          FROM invoice_draft_lines WHERE id = ?
        `,
      )
      .get(businessIds.draftLineId),
    database
      .prepare(
        `
          SELECT total_net_cents AS net, total_vat_cents AS vat,
                 total_gross_cents AS gross
          FROM invoices WHERE id = ?
        `,
      )
      .get(businessIds.invoiceId),
    database
      .prepare(
        `
          SELECT net_cents AS net, vat_cents AS vat, gross_cents AS gross
          FROM invoice_lines WHERE id = ?
        `,
      )
      .get(businessIds.invoiceLineId),
  ] as readonly ({ net?: unknown; vat?: unknown; gross?: unknown } | undefined)[];
  if (
    rows.some(
      (row) =>
        Number(row?.net) !== expected.netCents ||
        Number(row?.vat) !== expected.vatCents ||
        Number(row?.gross) !== expected.grossCents,
    )
  ) {
    throw new Error('W6B2_BUSINESS_TOTALS_INCONSISTENT');
  }
}

function requireHealthySqliteDatabase(database: DatabaseSync): void {
  const integrityRows = database
    .prepare('PRAGMA integrity_check;')
    .all() as readonly Record<string, unknown>[];
  const integrityResult = integrityRows[0]
    ? Object.values(integrityRows[0])[0]
    : undefined;
  const foreignKeyRows = database.prepare('PRAGMA foreign_key_check;').all();
  if (
    integrityRows.length !== 1 ||
    integrityResult !== 'ok' ||
    foreignKeyRows.length !== 0
  ) {
    throw new Error('W6B2_SQLITE_PROFILE_INVALID');
  }
}
