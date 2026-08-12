import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { runMigrations } from '../../database/migration/runMigrations.js';
import { createProfileBackupIdentity } from './inspectSqliteProfileDatabase.js';
import { StagedProfileSnapshotValidationService } from './validateProfileSnapshot.js';

const migrationName = '001_create_profile_fixture.sql';
const migrationSql = `
  CREATE TABLE local_runtime_identity (
    singleton_key TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    company_id TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
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
`;
const openDatabases: Database.Database[] = [];
const temporaryRoots: string[] = [];

afterEach(async () => {
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('staged profile snapshot validation', () => {
  it('can be composed before the first profile migrations run', async () => {
    const root = await mkdtemp(
      join(tmpdir(), 'eky-profile-validation-empty-'),
    );
    temporaryRoots.push(root);
    const activeDatabase = new Database(':memory:');
    openDatabases.push(activeDatabase);

    expect(
      () =>
        new StagedProfileSnapshotValidationService({
          activeDatabase,
          migrationsDirectory: join(root, 'migrations'),
          stagingRoot: join(root, 'staging'),
        }),
    ).not.toThrow();
  });

  it('validates SQLite identity, migrations and every invoice PDF', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).resolves.toEqual({
      activeProfileIsEmpty: true,
      artifactCount: 1,
      artifactTotalByteSize: fixture.pdfBytes.byteLength,
      databaseHealth: 'healthy',
      migrationChainIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      profileId: createProfileBackupIdentity('company-1'),
      profileMatchesActive: true,
    });
  });

  it('materializes a writable activation database and validated document tree', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.service.prepareProfileRestoreActivation(
        fixture.operationId,
      ),
    ).resolves.toEqual({
      artifactCount: 1,
      artifactTotalByteSize: fixture.pdfBytes.byteLength,
    });

    const restoredPdfPath = join(
      fixture.operationRoot,
      'activation',
      'storage',
      'invoices',
      'company-1',
      'invoice-1',
      'approved-invoice.pdf',
    );
    await expect(readFile(restoredPdfPath)).resolves.toEqual(
      fixture.pdfBytes,
    );
    await expect(lstat(restoredPdfPath)).resolves.toMatchObject({
      nlink: 1,
    });
    const writableDatabase = new Database(fixture.databasePath);
    writableDatabase.close();
  });

  it('never overwrites an existing activation tree', async () => {
    const fixture = await createFixture();
    const activationRoot = join(
      fixture.operationRoot,
      'activation',
      'storage',
      'invoices',
    );
    await mkdir(activationRoot, { recursive: true });

    await expect(
      fixture.service.prepareProfileRestoreActivation(
        fixture.operationId,
      ),
    ).rejects.toThrow(
      'PROFILE_RESTORE_ACTIVATION_PREPARATION_FAILED',
    );
  });

  it('reports a foreign profile without exposing the source company id', async () => {
    const fixture = await createFixture({
      stagedCompanyId: 'other-company',
    });

    const result = await fixture.service.validateProfileSnapshot(
      fixture.operationId,
    );

    expect(result.profileMatchesActive).toBe(false);
    expect(JSON.stringify(result)).not.toContain('other-company');
  });

  it('reports a non-empty active profile without exposing table details', async () => {
    const fixture = await createFixture({ activeHasInvoice: true });

    const result = await fixture.service.validateProfileSnapshot(
      fixture.operationId,
    );

    expect(result.activeProfileIsEmpty).toBe(false);
    expect(JSON.stringify(result)).not.toContain('invoices');
  });

  it.each([
    ['missing PDF', async (fixture: Fixture) => {
      await rm(fixture.pdfPath);
    }],
    ['tampered PDF', async (fixture: Fixture) => {
      await writeFile(fixture.pdfPath, '%PDF-1.7 changed');
    }],
    ['extra staged file', async (fixture: Fixture) => {
      await writeFile(join(fixture.operationRoot, 'unexpected.txt'), 'extra');
    }],
    ['catalog metadata mismatch', async (fixture: Fixture) => {
      const catalog = JSON.parse(
        await readFile(fixture.catalogPath, 'utf8'),
      ) as { artifacts: Array<{ fileName: string }> };
      catalog.artifacts[0]!.fileName = 'different.pdf';
      await writeFile(fixture.catalogPath, `${JSON.stringify(catalog)}\n`);
    }],
  ])('fails closed for %s', async (_name, mutate) => {
    const fixture = await createFixture();
    await mutate(fixture);

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });

  it('rejects a foreign-key-invalid staged database', async () => {
    const fixture = await createFixture();
    const database = new Database(fixture.databasePath);
    database.pragma('foreign_keys = OFF');
    database
      .prepare('DELETE FROM invoices WHERE id = ?')
      .run('invoice-1');
    database.close();

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });

  it('accepts an exact historical migration prefix for update rollback', async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.migrationsDirectory, '002_unapplied.sql'),
      'CREATE TABLE unapplied (id TEXT PRIMARY KEY);',
    );

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).resolves.toEqual(
      expect.objectContaining({
        databaseHealth: 'healthy',
        migrationChainIdentity: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
  });

  it('rejects a staged database with a migration outside the packaged manifest', async () => {
    const fixture = await createFixture();
    const database = new Database(fixture.databasePath);
    database.exec('PRAGMA foreign_keys = OFF;');
    database
      .prepare(
        'INSERT INTO schema_migrations (name, run_at) VALUES (?, ?)',
      )
      .run('999_future.sql', '2026-08-12T00:00:00.000Z');
    database.close();

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });

  it('rejects staged data with missing migration metadata', async () => {
    const fixture = await createFixture();
    const database = new Database(fixture.databasePath);
    database.exec('DELETE FROM schema_migration_metadata;');
    database.close();

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });

  it('rejects staged data after historical migration SQL changes', async () => {
    const fixture = await createFixture();
    await writeFile(
      join(fixture.migrationsDirectory, migrationName),
      `${migrationSql}\nCREATE TABLE changed_history (id TEXT PRIMARY KEY);`,
    );

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });

  it('rejects a corrupt SQLite file', async () => {
    const fixture = await createFixture();
    await writeFile(fixture.databasePath, 'not a sqlite database');

    await expect(
      fixture.service.validateProfileSnapshot(fixture.operationId),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });

  it.skipIf(process.platform === 'win32')(
    'rejects a symbolic-link PDF',
    async () => {
      const fixture = await createFixture();
      const targetPath = join(fixture.operationRoot, 'target.pdf');
      await writeFile(targetPath, fixture.pdfBytes);
      await rm(fixture.pdfPath);
      await symlink(targetPath, fixture.pdfPath);

      await expect(
        fixture.service.validateProfileSnapshot(fixture.operationId),
      ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
    },
  );

  it('RESTORE-PATH-001 @security rejects invalid operation identifiers before filesystem access', async () => {
    const fixture = await createFixture();

    await expect(
      fixture.service.validateProfileSnapshot('../profile'),
    ).rejects.toThrow('PROFILE_SNAPSHOT_VALIDATION_FAILED');
  });
});

interface Fixture {
  catalogPath: string;
  databasePath: string;
  migrationsDirectory: string;
  operationId: string;
  operationRoot: string;
  pdfBytes: Buffer;
  pdfPath: string;
  service: StagedProfileSnapshotValidationService;
}

async function createFixture(
  options: {
    activeHasInvoice?: boolean;
    stagedCompanyId?: string;
  } = {},
): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'eky-profile-validation-'));
  temporaryRoots.push(root);
  const stagingRoot = join(root, 'staging');
  const migrationsDirectory = join(root, 'migrations');
  const operationId = randomUUID();
  const operationRoot = join(stagingRoot, operationId);
  const databasePath = join(operationRoot, 'profile.sqlite');
  const catalogPath = join(operationRoot, 'snapshot-catalog-v1.json');
  const pdfBytes = Buffer.from('%PDF-1.7\nsynthetic invoice\n', 'utf8');
  const documentId = 'document-1';
  const logicalPath =
    `artifacts/invoicing/invoice-documents/` +
    `${sha256(Buffer.from(documentId, 'utf8'))}.pdf`;
  const pdfPath = join(operationRoot, ...logicalPath.split('/'));

  await mkdir(operationRoot, { mode: 0o700, recursive: true });
  await chmod(stagingRoot, 0o700);
  await chmod(operationRoot, 0o700);
  await mkdir(migrationsDirectory, { mode: 0o700 });
  await writeFile(join(migrationsDirectory, migrationName), migrationSql);

  const activeDatabase = await createProfileDatabase(
    ':memory:',
    'company-1',
    options.activeHasInvoice ?? false,
    pdfBytes,
    migrationsDirectory,
  );
  openDatabases.push(activeDatabase);
  const stagedDatabase = await createProfileDatabase(
    databasePath,
    options.stagedCompanyId ?? 'company-1',
    true,
    pdfBytes,
    migrationsDirectory,
  );
  stagedDatabase.close();

  await mkdir(dirname(pdfPath), { mode: 0o700, recursive: true });
  await writeFile(pdfPath, pdfBytes);
  const catalogEntry = {
    byteSize: pdfBytes.byteLength,
    fileName: 'invoice.pdf',
    logicalPath,
    mediaType: 'application/pdf',
    owner: 'invoicing',
    restoreValidationIdentity: {
      companyId: options.stagedCompanyId ?? 'company-1',
      documentId,
      documentType: 'approved_invoice_pdf',
      invoiceId: 'invoice-1',
      storagePath: 'company-1/invoice-1/approved-invoice.pdf',
    },
    sha256: sha256(pdfBytes),
    sourceIdentity: {
      companyId: options.stagedCompanyId ?? 'company-1',
      documentId,
      invoiceId: 'invoice-1',
      storagePath: 'company-1/invoice-1/approved-invoice.pdf',
    },
  };
  await writeFile(
    catalogPath,
    `${JSON.stringify({
      artifacts: [catalogEntry],
      formatVersion: 1,
    })}\n`,
  );

  return {
    catalogPath,
    databasePath,
    migrationsDirectory,
    operationId,
    operationRoot,
    pdfBytes,
    pdfPath,
    service: new StagedProfileSnapshotValidationService({
      activeDatabase,
      migrationsDirectory,
      stagingRoot,
    }),
  };
}

async function createProfileDatabase(
  path: string,
  companyId: string,
  includeArtifact: boolean,
  pdfBytes: Buffer,
  migrationsDirectory: string,
): Promise<Database.Database> {
  const database = new Database(path);
  await runMigrations(database, { migrationsDirectory });
  database
    .prepare(
      `
        INSERT INTO local_runtime_identity (
          singleton_key,
          installation_id,
          company_id,
          actor_id,
          created_at
        ) VALUES ('local-runtime', ?, ?, 'local-owner', ?)
      `,
    )
    .run('a'.repeat(32), companyId, '2026-08-04T00:00:00.000Z');

  if (includeArtifact) {
    database
      .prepare(
        'INSERT INTO invoices (id, company_id) VALUES (?, ?)',
      )
      .run('invoice-1', companyId);
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
        companyId,
        'invoice-1',
        'approved_invoice_pdf',
        'invoice.pdf',
        'company-1/invoice-1/approved-invoice.pdf',
        'application/pdf',
        sha256(pdfBytes),
        pdfBytes.byteLength,
        '2026-08-04T00:00:00.000Z',
      );
  }

  return database;
}

function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex');
}
