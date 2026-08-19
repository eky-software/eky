import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { createProfileBackupIdentity } from './inspectSqliteProfileDatabase.js';
import { CurrentActiveProfileValidationService } from './validateActiveProfile.js';

const roots: string[] = [];
const databases: Database.Database[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) {
    database.close();
  }
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('active profile validation', () => {
  it('validates a freshly migrated profile without business artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'eky-active-profile-empty-'));
    roots.push(root);
    const database = new Database(':memory:');
    databases.push(database);
    database.pragma('foreign_keys = ON');
    await runMigrations(database);

    const service = new CurrentActiveProfileValidationService(
      database,
      join(root, 'storage', 'invoices'),
      () => 'c'.repeat(64),
    );

    await expect(service.validateActiveProfile()).resolves.toEqual({
      artifactCount: 0,
      artifactTotalByteSize: 0,
      databaseHealth: 'healthy',
      migrationChainIdentity: 'c'.repeat(64),
      profileId: createProfileBackupIdentity('dev-company'),
    });
  });

  it('validates every database-owned PDF from active storage', async () => {
    const fixture = await createFixture();

    await expect(fixture.service.validateActiveProfile()).resolves.toEqual({
      artifactCount: 1,
      artifactTotalByteSize: fixture.pdf.byteLength,
      databaseHealth: 'healthy',
      migrationChainIdentity: 'c'.repeat(64),
      profileId: createProfileBackupIdentity('company-1'),
    });
  });

  it.each([
    ['missing document', async (fixture: Fixture) => {
      await rm(fixture.pdfPath);
    }],
    ['tampered document', async (fixture: Fixture) => {
      await writeFile(fixture.pdfPath, '%PDF-1.7 tampered');
    }],
    ['unsafe storage path', async (fixture: Fixture) => {
      fixture.database
        .prepare('UPDATE invoice_documents SET storage_path = ?')
        .run('../escape.pdf');
    }],
  ])('BACKUP-MISSING-DOCUMENT-001 @fault fails closed for %s', async (_name, mutate) => {
    const fixture = await createFixture();
    await mutate(fixture);

    await expect(
      fixture.service.validateActiveProfile(),
    ).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
  });

  it('rejects a foreign-key-invalid active database', async () => {
    const fixture = await createFixture();
    fixture.database.pragma('foreign_keys = OFF');
    fixture.database.prepare('DELETE FROM invoices').run();

    await expect(
      fixture.service.validateActiveProfile(),
    ).rejects.toThrow('ACTIVE_PROFILE_VALIDATION_FAILED');
  });
});

interface Fixture {
  database: Database.Database;
  pdf: Buffer;
  pdfPath: string;
  service: CurrentActiveProfileValidationService;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'eky-active-profile-'));
  roots.push(root);
  const storageRoot = join(root, 'storage', 'invoices');
  const pdfPath = join(
    storageRoot,
    'company-1',
    'invoice-1',
    'approved-invoice.pdf',
  );
  const pdf = Buffer.from('%PDF-1.7\nsynthetic\n', 'ascii');
  await mkdir(dirname(pdfPath), { recursive: true });
  await writeFile(pdfPath, pdf);

  const database = new Database(':memory:');
  databases.push(database);
  database.pragma('foreign_keys = ON');
  database.exec(`
    CREATE TABLE invoices (
      id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      PRIMARY KEY (id)
    );
    CREATE TABLE invoice_documents (
      id TEXT NOT NULL PRIMARY KEY,
      company_id TEXT NOT NULL,
      invoice_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      storage_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY (invoice_id) REFERENCES invoices (id)
    );
    CREATE TABLE local_runtime_identity (
      singleton_key TEXT NOT NULL PRIMARY KEY,
      actor_id TEXT NOT NULL,
      company_id TEXT NOT NULL,
      installation_id TEXT NOT NULL
    );
    INSERT INTO local_runtime_identity (
      singleton_key,
      actor_id,
      company_id,
      installation_id
    ) VALUES (
      'local-runtime',
      'local-owner',
      'company-1',
      'installation-1'
    );
  `);
  database
    .prepare(
      `INSERT INTO invoices (id, company_id) VALUES (?, ?)`,
    )
    .run('invoice-1', 'company-1');
  database
    .prepare(
      `
        INSERT INTO invoice_documents (
          id,
          company_id,
          invoice_id,
          document_type,
          file_name,
          storage_path,
          mime_type,
          sha256,
          size_bytes,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
      'document-1',
      'company-1',
      'invoice-1',
      'approved_invoice_pdf',
      'invoice.pdf',
      'company-1/invoice-1/approved-invoice.pdf',
      'application/pdf',
      createHash('sha256').update(pdf).digest('hex'),
      pdf.byteLength,
      '2026-08-04T00:00:00.000Z',
    );

  return {
    database,
    pdf,
    pdfPath,
    service: new CurrentActiveProfileValidationService(
      database,
      storageRoot,
      () => 'c'.repeat(64),
    ),
  };
}
