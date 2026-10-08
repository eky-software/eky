import Database from 'better-sqlite3';

import type { DatabaseConnection } from '../../../database/connection/createDatabaseConnection.js';
import {
  closeDatabases,
  historicalDatabase,
  insert,
  migrate,
  type Row,
} from '../../../database/migration/invoiceContentRevisionMigration.fixture.js';
import { documentRow } from '../../../database/migration/invoiceContentRevisionMigrationBinding.fixture.js';
import {
  header, line, publish, vat,
} from '../../../database/migration/invoiceContentRevisionMigrationSnapshot.fixture.js';
import type {
  LegacyOriginalInvoiceDocumentMetadata,
  RevisionInvoiceDocumentMetadata,
} from '../domain/approvedInvoiceDocument.js';
import type { InvoiceRevisionKey, InvoiceScope } from '../domain/invoiceContentRevision.js';
import type { InvoiceDocumentCandidate } from '../ports/invoiceDocumentRepository.js';
import {
  createApprovalRevisionFixture,
  createRevisionDraft,
  readApprovalState,
  revisionApprovalInput,
} from './invoiceApprovalRevision.fixture.js';
import { createInvoiceDocumentStoragePath } from './invoiceDocumentFilePolicy.js';
import { SqliteInvoiceDocumentRepository } from './sqliteInvoiceDocumentRepository.js';

const databases: DatabaseConnection[] = [];

export function openPublicationDatabase(
  path = ':memory:',
  onStatement?: (sql: string) => void,
): DatabaseConnection {
  const database = new Database(path, {
    timeout: 0,
    ...(onStatement ? { verbose: (sql) => onStatement(String(sql)) } : {}),
  });
  databases.push(database);
  database.pragma('foreign_keys = ON');
  return database;
}

export function closePublicationDatabases(): void {
  for (const database of databases.splice(0)) {
    if (database.open) database.close();
  }
  closeDatabases();
}

export async function createPublicationFixture(database: DatabaseConnection) {
  const approval = await createApprovalRevisionFixture(database);
  async function approve(invoiceId: string, companyId = 'revision-company') {
    const draft = createRevisionDraft({ id: `${invoiceId}-draft`, companyId });
    await approval.drafts.saveDraft({
      ...draft,
      lines: draft.lines.map((entry) => ({ ...entry, id: `${invoiceId}-${entry.id}` })),
    });
    const result = await approval.repository.approveDraft(revisionApprovalInput({
      companyId, invoiceId, draftId: draft.id, auditEventId: `${invoiceId}-audit`,
    }));
    if (!result) throw new Error('Synthetic approval did not publish a revision.');
    return result.revisionKey;
  }
  const key = await approve('revision-invoice');
  return { key, approve, approval, repository: new SqliteInvoiceDocumentRepository(database) };
}

export function documentCandidate(
  scope: InvoiceScope,
  id = 'document-first',
  overrides: Partial<InvoiceDocumentCandidate> = {},
): InvoiceDocumentCandidate {
  return {
    id,
    fileName: 'Synthetic invoice 20270001.pdf',
    storagePath: createInvoiceDocumentStoragePath(scope, id),
    sha256: '0123456789abcdef'.repeat(4),
    sizeBytes: 137,
    createdAt: '2027-01-15T12:01:02.345Z',
    ...overrides,
  };
}

export function expectedRevisionDocument(
  key: InvoiceRevisionKey,
  candidate: InvoiceDocumentCandidate,
): RevisionInvoiceDocumentMetadata {
  return {
    ...candidate,
    companyId: key.companyId,
    invoiceId: key.invoiceId,
    documentType: 'approved_invoice_pdf',
    mimeType: 'application/pdf',
    binding: { kind: 'revision', revisionId: key.revisionId },
  };
}

export function publicationState(database: DatabaseConnection) {
  return {
    ...readApprovalState(database),
    documents: database.prepare('SELECT * FROM invoice_documents ORDER BY id').all(),
    events: database.prepare('SELECT * FROM invoice_delivery_events ORDER BY id').all(),
  };
}

export function setInvoiceStatus(
  database: DatabaseConnection,
  scope: InvoiceScope,
  status: 'approved' | 'sent' | 'reopened_for_edit' | 'cancelled',
): void {
  database.prepare(`
    UPDATE invoices SET status = ?, cancelled_at = ?, cancelled_by = ?, cancellation_reason = ?
    WHERE company_id = ? AND id = ?
  `).run(
    status,
    status === 'cancelled' ? '2027-01-16T12:00:00.000Z' : null,
    status === 'cancelled' ? 'synthetic-actor' : null,
    status === 'cancelled' ? 'Synthetic cancellation' : null,
    scope.companyId, scope.invoiceId,
  );
}

export function setCurrentRevision(database: DatabaseConnection, key: InvoiceRevisionKey): void {
  database.prepare(`
    UPDATE invoice_current_revisions SET revision_id = ? WHERE company_id = ? AND invoice_id = ?
  `).run(key.revisionId, key.companyId, key.invoiceId);
}

export function nextPublicationRevision(
  database: DatabaseConnection,
  key: InvoiceRevisionKey,
): InvoiceRevisionKey {
  const revisionId = `${key.revisionId}-next`;
  const original = database.prepare<[string], Row>(
    'SELECT * FROM invoice_content_revisions WHERE id = ?',
  ).get(key.revisionId);
  if (!original) throw new Error('Synthetic source revision missing.');
  // Reuse the production-migration fixture's header-last publication, not new DDL.
  publish(database, { ...original, id: revisionId },
    database.prepare<[string], Row>(
      'SELECT * FROM invoice_revision_lines WHERE revision_id = ?',
    ).all(key.revisionId).map((entry) => ({ ...entry, revision_id: revisionId })),
    database.prepare<[string], Row>(
      'SELECT * FROM invoice_revision_vat_breakdown WHERE revision_id = ?',
    ).all(key.revisionId).map((entry) => ({ ...entry, revision_id: revisionId })),
  );
  const next = { ...key, revisionId };
  setCurrentRevision(database, next);
  return next;
}

export async function createLegacyPublicationFixture(
  event: {
    status: 'attempted' | 'outcomeUnknown' | 'failed' | 'succeeded';
    documentId?: null;
    provider?: 'smtp' | 'dryRun' | 'gmail' | 'microsoft';
  } | null = { status: 'succeeded' },
) {
  const database = await historicalDatabase();
  const scope = { companyId: 'dev-company', invoiceId: 'invoice-1' };
  const original: LegacyOriginalInvoiceDocumentMetadata = {
    id: 'document-legacy', ...scope,
    documentType: 'approved_invoice_pdf', mimeType: 'application/pdf',
    fileName: 'Original synthetic invoice.pdf', storagePath: 'synthetic/original.pdf',
    sha256: 'a'.repeat(64), sizeBytes: 64, createdAt: '2026-06-01T00:00:00Z',
    binding: { kind: 'legacyOriginal' },
  };
  const row = documentRow({
    id: original.id, file_name: original.fileName, storage_path: original.storagePath,
    sha256: original.sha256, size_bytes: original.sizeBytes, created_at: original.createdAt,
  });
  delete row.binding_kind;
  delete row.revision_id;
  delete row.source_document_id;
  insert(database, 'invoice_documents', row);
  if (event) insert(database, 'invoice_delivery_events', {
    id: 'legacy-smtp-event', company_id: scope.companyId, invoice_id: scope.invoiceId,
    document_id: event.documentId === null ? null : original.id,
    delivery_method: 'email', provider: event.provider ?? 'smtp', status: event.status,
    created_at: '2026-06-01T00:00:00Z',
  });
  setInvoiceStatus(database, scope, 'sent');
  await migrate(database);
  const source = { documentId: original.id, sha256: original.sha256, sizeBytes: original.sizeBytes };
  const candidate = documentCandidate(scope, 'document-preserved', {
    sha256: source.sha256, sizeBytes: source.sizeBytes,
  });
  return {
    database, scope, original, source, candidate,
    repository: new SqliteInvoiceDocumentRepository(database),
  };
}

export function publishValidatedLegacyRevision(database: DatabaseConnection): InvoiceRevisionKey {
  const key = { companyId: 'dev-company', invoiceId: 'invoice-1', revisionId: 'validated-legacy' };
  publish(database, header(database, { id: key.revisionId, origin: 'validatedLegacySnapshot' }),
    [line({ revision_id: key.revisionId })], [vat({ revision_id: key.revisionId })]);
  setCurrentRevision(database, key);
  return key;
}

export function corruptDocumentMetadata(database: DatabaseConnection, documentId: string, values: Row): void {
  const triggers = database.prepare<[], { name: string; sql: string }>(`
    SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'invoice_documents'
  `).all();
  const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;
  // Corrupt only this isolated fixture; restore real guards before invoking the reader.
  database.pragma('foreign_keys = OFF');
  database.pragma('ignore_check_constraints = ON');
  try {
    for (const trigger of triggers) database.exec(`DROP TRIGGER ${identifier(trigger.name)}`);
    database.prepare(`
      UPDATE invoice_documents SET ${Object.keys(values).map((name) => `${identifier(name)} = ?`).join(', ')}
      WHERE id = ?
    `).run(...Object.values(values), documentId);
  } finally {
    for (const trigger of triggers) database.exec(trigger.sql);
    database.pragma('ignore_check_constraints = OFF');
    database.pragma('foreign_keys = ON');
  }
}
