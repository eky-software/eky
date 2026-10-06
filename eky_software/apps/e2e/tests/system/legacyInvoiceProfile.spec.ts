import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createDatabaseConnection } from '../../../backend/src/database/connection/createDatabaseConnection.js';
import { runMigrations } from '../../../backend/src/database/migration/runMigrations.js';
import { createLegacyInvoiceProfile } from '../../src/data/createLegacyInvoiceProfile.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';

test('SYS-LEGACY-INVOICE-FIXTURE-001 @critical @security seeds 038 without fabricating a delivery revision', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  mkdirSync(userDataPath);
  try {
    const fixture = await createLegacyInvoiceProfile({ runRoot, userDataPath });
    const file = join(userDataPath, 'runtime', 'storage', 'invoices', 'legacy', 'original.pdf');
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(fixture.pdfSha256);
    const database = createDatabaseConnection({ databaseFilePath: join(userDataPath, 'runtime', 'data', 'eky.sqlite') });
    try {
      expect(database.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toHaveLength(38);
      expect(database.prepare("SELECT name FROM sqlite_master WHERE name = 'invoice_content_revisions'").get()).toBeUndefined();
      const original = database.prepare('SELECT * FROM invoice_delivery_events WHERE id = ?').get(fixture.eventId);
      expect(original).toMatchObject({ invoice_id: fixture.invoiceId, document_id: fixture.documentId, status: 'succeeded' });
      await runMigrations(database);
      expect(database.prepare('SELECT name FROM schema_migrations ORDER BY name').all()).toHaveLength(39);
      expect(database.prepare('SELECT * FROM invoice_delivery_events WHERE id = ?').get(fixture.eventId))
        .toMatchObject({ ...original as object, binding_kind: 'legacyOriginal', revision_id: null, send_mode: 'legacyUnknown' });
      expect(database.prepare('SELECT * FROM invoice_documents WHERE id = ?').get(fixture.documentId))
        .toMatchObject({ binding_kind: 'legacyOriginal', revision_id: null, sha256: fixture.pdfSha256, size_bytes: bytes.length });
      expect(database.prepare('SELECT status, invoice_number FROM invoices WHERE id = ?').get(fixture.invoiceId))
        .toEqual({ status: 'sent', invoice_number: fixture.invoiceNumber });
      expect(readFileSync(file)).toEqual(bytes);
    } finally { database.close(); }
    await expect(createLegacyInvoiceProfile({ runRoot, userDataPath })).rejects.toThrow('LEGACY_INVOICE_FIXTURE_ALREADY_EXISTS');
    expect(readFileSync(file)).toEqual(bytes);
  } finally { await removeE2eRunRoot(runRoot); }
});

test('SYS-LEGACY-INVOICE-FIXTURE-002 @critical @security refuses sibling profiles and linked preparation paths', async () => {
  const runRoot = createE2eRunRoot();
  const otherRoot = createE2eRunRoot();
  const link = join(runRoot, 'linked-profile');
  try {
    await expect(createLegacyInvoiceProfile({ runRoot, userDataPath: otherRoot })).rejects.toThrow('LEGACY_INVOICE_FIXTURE_ROOT_INVALID');
    symlinkSync(otherRoot, link, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(createLegacyInvoiceProfile({ runRoot, userDataPath: link })).rejects.toThrow('LEGACY_INVOICE_FIXTURE_ROOT_INVALID');
    expect(readdirSync(otherRoot)).toEqual([]);
  } finally {
    if (existsSync(link)) unlinkSync(link);
    await removeE2eRunRoot(runRoot);
    await removeE2eRunRoot(otherRoot);
  }
});

test('SYS-LEGACY-INVOICE-FIXTURE-003 @critical retains preparation evidence without replacing an existing runtime', async () => {
  const runRoot = createE2eRunRoot();
  const userDataPath = join(runRoot, 'user-data');
  const runtimeRoot = join(userDataPath, 'runtime');
  mkdirSync(runtimeRoot, { recursive: true });
  const evidence = join(runtimeRoot, 'evidence.json');
  writeFileSync(evidence, '{"synthetic":true}', { flag: 'wx' });
  try {
    await expect(createLegacyInvoiceProfile({ runRoot, userDataPath })).rejects.toThrow('LEGACY_INVOICE_FIXTURE_ALREADY_EXISTS');
    expect(readFileSync(evidence, 'utf8')).toBe('{"synthetic":true}');
    expect(existsSync(join(userDataPath, 'legacy-invoice-source-migrations'))).toBe(false);
  } finally { await removeE2eRunRoot(runRoot); }
});
