import { createHash } from 'node:crypto';
import {
  link,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  snapshotW6b2PackagedWorkspaceEvidence,
  snapshotW6b2PackagedWorkspaceFileEvidence,
  w6b2PackagedWorkspaceContentPreserved,
} from './w6b2PackagedWorkspaceEvidence.js';
import {
  createW6b2PackagedWorkspaceEvidenceTestFixture,
  mutateW6b2EvidenceTestDatabase,
} from './w6b2PackagedWorkspaceEvidenceTestFixture.js';
import { invalidateWorkspaceFirstStartProofContent } from './workspaceFirstStartMigrationProofFixtures.js';

vi.mock('electron', () => ({ utilityProcess: { fork: vi.fn() } }));

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 packaged workspace content evidence', () => {
  it.each(['A', 'B'] as const)('requires healthy SQLite for %s', async fixtureKey => {
    const fixture = await createW6b2PackagedWorkspaceEvidenceTestFixture(await createRoot(), fixtureKey);
    const before = await readFile(fixture.databaseFilePath);
    await snapshotW6b2PackagedWorkspaceEvidence(fixture);
    expect(await readFile(fixture.databaseFilePath)).toEqual(before);

    await invalidateWorkspaceFirstStartProofContent(fixture);
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');
  });

  it('requires healthy C before injection and the exact orphan afterwards without writes', async () => {
    const fixture = await createW6b2PackagedWorkspaceEvidenceTestFixture(await createRoot(), 'C');
    const before = await snapshotW6b2PackagedWorkspaceEvidence(fixture, 'beforeContentFault');
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');

    await invalidateWorkspaceFirstStartProofContent(fixture);
    const bytes = await readFile(fixture.databaseFilePath);
    const after = await snapshotW6b2PackagedWorkspaceEvidence(fixture);
    expect(w6b2PackagedWorkspaceContentPreserved(before, after)).toBe(true);
    expect(after.database.sha256).not.toBe(before.database.sha256);
    expect(after.database.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(await snapshotW6b2PackagedWorkspaceEvidence(fixture)).toEqual(after);
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture, 'beforeContentFault'))
      .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');
    expect(await readFile(fixture.databaseFilePath)).toEqual(bytes);
  });

  it.each([
    ['id', 'different-orphan'],
    ['company_id', 'different-company'],
    ['invoice_id', 'different-missing-invoice'],
    ['actor_user_id', 'different-actor'],
    ['action', 'paymentMarkReverted'],
    ['payment_source', 'different-source'],
    ['paid_on', '2026-01-02'],
    ['amount_cents', 2],
    ['occurred_at', '2026-01-02T00:00:00.000Z'],
  ] as const)('rejects an altered synthetic orphan field: %s', async (column, value) => {
    const fixture = await createOrphanFixture();
    mutateW6b2EvidenceTestDatabase(fixture.databaseFilePath, database => {
      database.prepare(`UPDATE invoice_payment_events SET ${column} = ?`).run(value);
    });
    const before = await readFile(fixture.databaseFilePath);
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');
    expect(await readFile(fixture.databaseFilePath)).toEqual(before);
  });

  it.each([
    ['table', 'invoice_documents'],
    ['rowid', 999],
    ['parent', 'customers'],
    ['fkid', 1],
  ] as const)('rejects a different FK diagnostic %s even with the exact orphan', async (field, value) => {
    const fixture = await createOrphanFixture();
    const prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql) {
      const statement = prepare.call(this, sql);
      if (sql === 'PRAGMA foreign_key_check;') {
        const rows = statement.all();
        vi.spyOn(statement, 'all').mockReturnValue([{ ...rows[0], [field]: value }]);
      }
      return statement;
    });
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');
  });

  it.each(['additional-payment', 'unrelated-document'] as const)(
    'rejects an additional FK violation: %s', async kind => {
      const fixture = await createOrphanFixture();
      mutateW6b2EvidenceTestDatabase(fixture.databaseFilePath, database => {
        if (kind === 'additional-payment') {
          database.exec(`INSERT INTO invoice_payment_events
            SELECT 'another-orphan', company_id, invoice_id, actor_user_id,
                   action, payment_source, paid_on, amount_cents, occurred_at
            FROM invoice_payment_events;`);
        } else {
          database.exec("UPDATE invoice_documents SET invoice_id = 'missing-invoice';");
        }
      });
      await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
        .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');
    },
  );

  it.each([
    ['failed', [{ integrity_check: 'synthetic integrity failure' }]],
    ['missing', []],
    ['extra', [{ integrity_check: 'ok' }, { integrity_check: 'ok' }]],
  ] as const)('rejects %s integrity diagnostics even with the exact orphan FK', async (_, rows) => {
    const fixture = await createOrphanFixture();
    const prepare = DatabaseSync.prototype.prepare;
    vi.spyOn(DatabaseSync.prototype, 'prepare').mockImplementation(function (this: DatabaseSync, sql) {
      const statement = prepare.call(this, sql);
      if (sql === 'PRAGMA integrity_check;') {
        vi.spyOn(statement, 'all').mockReturnValue([...rows]);
      }
      return statement;
    });
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_SQLITE_INVALID');
  });

  it.each(['A', 'B', 'C'] as const)('retains business checks for %s', async fixtureKey => {
    const fixture = await createW6b2PackagedWorkspaceEvidenceTestFixture(await createRoot(), fixtureKey);
    if (fixtureKey === 'C') await invalidateWorkspaceFirstStartProofContent(fixture);
    mutateW6b2EvidenceTestDatabase(fixture.databaseFilePath, database => {
      database.exec('UPDATE invoices SET total_gross_cents = 1;');
    });
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_BUSINESS_INVALID');
  });

  it('retains PDF and namespace content checks for C', async () => {
    const fixture = await createOrphanFixture();
    const before = await snapshotW6b2PackagedWorkspaceEvidence(fixture);
    await writeFile(fixture.archiveSentinelFilePath, 'changed');
    const after = await snapshotW6b2PackagedWorkspaceEvidence(fixture);
    expect(w6b2PackagedWorkspaceContentPreserved(before, after)).toBe(false);
    await writeFile(fixture.businessArtifactPath, 'changed-pdf');
    await expect(snapshotW6b2PackagedWorkspaceEvidence(fixture))
      .rejects.toThrow('W6B2_EVIDENCE_PDF_INVALID');
  });
});

async function createOrphanFixture() {
  const fixture = await createW6b2PackagedWorkspaceEvidenceTestFixture(await createRoot(), 'C');
  await invalidateWorkspaceFirstStartProofContent(fixture);
  return fixture;
}

describe('W6B.2 packaged workspace file evidence', () => {
  it('accepts one ordinary regular file inside the canonical workspace root', async () => {
    const root = await createRoot();
    const path = join(root, 'evidence.bin');
    const bytes = Buffer.from('w6b2-evidence');
    await writeFile(path, bytes);

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).resolves.toEqual({
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
    });
  });

  it('rejects a symbolic link', async () => {
    const root = await createRoot();
    const target = join(root, 'target.bin');
    const path = join(root, 'evidence.bin');
    await writeFile(target, 'target');
    await symlink(target, path, 'file');

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('rejects a hard-linked file', async () => {
    const root = await createRoot();
    const target = join(root, 'target.bin');
    const path = join(root, 'evidence.bin');
    await writeFile(target, 'target');
    await link(target, path);

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('rejects a directory and a missing path with one safe error', async () => {
    const root = await createRoot();
    const directory = join(root, 'directory');
    await mkdir(directory);

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(directory, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(
        join(root, 'missing.bin'),
        root,
      ),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('rejects a regular file outside the canonical workspace root', async () => {
    const root = await createRoot();
    const outsideRoot = await createRoot();
    const path = join(outsideRoot, 'outside.bin');
    await writeFile(path, 'outside');

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });

  it('fails closed if the path identity changes between inspection and open', async () => {
    const root = await createRoot();
    const path = join(root, 'evidence.bin');
    const originalPath = join(root, 'original.bin');
    await writeFile(path, 'original');
    let swapped = false;

    await expect(
      snapshotW6b2PackagedWorkspaceFileEvidence(path, root, {
        async open(candidate, flags) {
          if (!swapped) {
            swapped = true;
            await rename(candidate, originalPath);
            await writeFile(candidate, 'replacement');
          }
          return open(candidate, flags);
        },
      }),
    ).rejects.toThrowError('W6B2_EVIDENCE_FILE_INVALID');
  });
});

async function createRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'eky-w6b2-evidence-'));
  temporaryRoots.push(root);
  return root;
}
