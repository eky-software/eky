import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import { createInvoiceReadModelTestDatabase } from '../../../backend/src/testFixtures/invoiceReadModelTestFixtures.js';
import { SqliteApprovedInvoiceReader } from '../../../backend/src/modules/invoicing/infrastructure/sqliteApprovedInvoiceReader.js';
import { renderApprovedInvoicePdf } from '../../../backend/src/modules/invoicing/infrastructure/pdf/approvedInvoicePdfRenderer.js';
import { assertPathUnderRoot } from '../environment/assertE2eSafetyBoundary.js';

export interface LegacyInvoiceProfile {
  readonly invoiceId: string;
  readonly invoiceNumber: string;
  readonly eventId: string;
  readonly documentId: string;
  readonly pdfSha256: string;
}

// Offline synthetic input only. The actual Electron startup must perform 039.
export async function createLegacyInvoiceProfile(input: {
  runRoot: string;
  userDataPath: string;
}): Promise<Readonly<LegacyInvoiceProfile>> {
  const baseRoot = realpathSync(resolve(tmpdir(), 'eky-e2e'));
  const rootRelative = relative(baseRoot, realpathSync(input.runRoot));
  const profileRelative = relative(input.runRoot, input.userDataPath);
  if (dirname(rootRelative) !== '.' || !basename(rootRelative).startsWith('run-') ||
      lstatSync(input.runRoot).isSymbolicLink() || profileRelative === '' ||
      isAbsolute(profileRelative) || profileRelative === '..' || profileRelative.startsWith(`..${sep}`)) {
    throw new Error('LEGACY_INVOICE_FIXTURE_ROOT_INVALID');
  }
  let parent = input.runRoot;
  for (const segment of profileRelative.split(sep)) {
    parent = join(parent, segment);
    if (lstatSync(parent).isSymbolicLink()) throw new Error('LEGACY_INVOICE_FIXTURE_ROOT_INVALID');
  }
  assertPathUnderRoot(input.runRoot, baseRoot);
  assertPathUnderRoot(input.userDataPath, input.runRoot);
  const runtimeRoot = join(input.userDataPath, 'runtime');
  if (existsSync(runtimeRoot)) throw new Error('LEGACY_INVOICE_FIXTURE_ALREADY_EXISTS');
  const source = resolve(import.meta.dirname, '../../../backend/src/database/migrations');
  const names = readdirSync(source).filter(name => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 38).sort();
  if (names.length !== 38 || !names[37]?.startsWith('038_')) throw new Error('LEGACY_INVOICE_FIXTURE_CHAIN_INVALID');
  const migrationRoot = join(input.userDataPath, 'legacy-invoice-source-migrations');
  mkdirSync(migrationRoot, { mode: 0o700 });
  for (const name of names) copyFileSync(join(source, name), join(migrationRoot, name));
  const database = await createInvoiceReadModelTestDatabase(migrationRoot);
  try {
    // The reusable snapshot fixture is synthetic dev-company data. Align its
    // historical runtime identity before the profile is ever handed to a runtime.
    database.exec(`
      UPDATE local_runtime_identity SET company_id = 'dev-company';
      UPDATE invoices SET status = 'sent';
      UPDATE invoice_drafts SET approved_invoice_id = 'invoice-1',
        approved_at = '2026-06-13T10:00:00.000Z' WHERE id = 'draft-1';
    `);
    const invoice = await new SqliteApprovedInvoiceReader(database).getApprovedInvoiceById('dev-company', 'invoice-1');
    if (invoice === undefined) throw new Error('LEGACY_INVOICE_FIXTURE_INVOICE_MISSING');
    const bytes = await renderApprovedInvoicePdf(invoice);
    const pdfSha256 = createHash('sha256').update(bytes).digest('hex');
    const documentsRoot = join(runtimeRoot, 'storage', 'invoices', 'legacy');
    const dataRoot = join(runtimeRoot, 'data');
    mkdirSync(documentsRoot, { recursive: true, mode: 0o700 });
    mkdirSync(dataRoot, { recursive: true, mode: 0o700 });
    writeFileSync(join(documentsRoot, 'original.pdf'), bytes, { flag: 'wx', mode: 0o600 });
    database.prepare(`INSERT INTO invoice_documents
      (id,company_id,invoice_id,document_type,file_name,storage_path,mime_type,sha256,size_bytes,created_at)
      VALUES ('legacy-document','dev-company','invoice-1','approved_invoice_pdf','original.pdf',
        'legacy/original.pdf','application/pdf',?,?, '2026-06-13T11:00:00.000Z')`).run(pdfSha256, bytes.byteLength);
    database.exec(`INSERT INTO invoice_delivery_events
      (id,company_id,invoice_id,document_id,delivery_method,provider,status,created_at)
      VALUES ('legacy-event','dev-company','invoice-1','legacy-document','email','smtp','succeeded',
        '2026-06-13T12:00:00.000Z')`);
    await database.backup(join(dataRoot, 'eky.sqlite'));
    return Object.freeze({ invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber,
      eventId: 'legacy-event', documentId: 'legacy-document', pdfSha256 });
  } finally {
    database.close();
  }
}
