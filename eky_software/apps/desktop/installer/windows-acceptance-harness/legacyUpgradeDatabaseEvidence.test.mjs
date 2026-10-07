import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, toNamespacedPath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import test from 'node:test';
import { createPackageFromStreams } from '@electron/asar';

import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { createLegacyDatabaseFixture, createLegacyDatabasePackageFixture, generateLegacyDatabaseContract,
  LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH, TARGET_DATABASE_IDENTITY, writeLegacyDatabaseBuildInfoFixture } from './legacyUpgradeDatabaseEvidence.fixture.mjs';
import { readLegacyDatabaseContract, readLegacyDatabasePackageBinding, verifyLegacyUpgradeDatabaseEvidence } from './legacyUpgradeDatabaseEvidence.mjs';

async function fixture(t, options) {
  const root = await mkdtemp(resolve(tmpdir(), 'eky-legacy-database-proof-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const paths = await createLegacyDatabaseFixture(root, options);
  const { contract, contractSha256 } = await readLegacyDatabaseContract();
  const count = options?.targetCount ?? 39;
  return { root, paths, contract, input: { ...paths, packageBinding: {
    ...TARGET_DATABASE_IDENTITY, contractSha256, migrationCount: count,
    migrationChainSha256: contract.migrations[count - 1].chainSha256,
  } } };
}

function changeDatabase(path, sql) {
  const database = new DatabaseSync(toNamespacedPath(path));
  try { database.exec('PRAGMA foreign_keys = OFF'); database.exec(sql); }
  finally { database.close(); }
}

function changeWithoutGuard(path, guard, sql) {
  const database = new DatabaseSync(toNamespacedPath(path));
  try {
    database.exec('PRAGMA foreign_keys = OFF');
    const original = database.prepare('SELECT sql FROM sqlite_schema WHERE name = ?').get(guard).sql;
    database.exec(`DROP TRIGGER "${guard}"`);
    database.exec(sql);
    database.exec(original);
  } finally { database.close(); }
}

test('038/039 contract is independently regenerated from the unchanged SQL in an empty database', async () => {
  const { contract } = await readLegacyDatabaseContract();
  assert.deepEqual(generateLegacyDatabaseContract(), contract);
  assert.equal(contract.revisionCopyFields.length, 64);
  assert.ok(contract.targetSchema.some(object => object.name === 'invoice_revision_update_guard'));
});

test('real 039 SQL fails the old byte condition but passes complete readonly content proof', async t => {
  const value = await fixture(t);
  const beforeSource = await createClosedDirectoryInventory(value.paths.sourceDataRoot);
  const beforeTarget = await createClosedDirectoryInventory(value.paths.targetDataRoot);
  const beforeStorage = await Promise.all([value.paths.sourceStorageRoot, value.paths.targetStorageRoot]
    .map(root => createClosedDirectoryInventory(root)));
  assert.equal(inventoriesMatch(beforeSource, beforeTarget), false);
  const proof = await verifyLegacyUpgradeDatabaseEvidence(value.input);
  assert.equal(proof.mode, 'migration038To039');
  assert.equal(proof.buildRevision, TARGET_DATABASE_IDENTITY.buildRevision);
  assert.deepEqual(await createClosedDirectoryInventory(value.paths.sourceDataRoot), beforeSource);
  assert.deepEqual(await createClosedDirectoryInventory(value.paths.targetDataRoot), beforeTarget);
  assert.deepEqual(await Promise.all([value.paths.sourceStorageRoot, value.paths.targetStorageRoot]
    .map(root => createClosedDirectoryInventory(root))), beforeStorage);
});

test('same-chain proof preserves the whole database byte condition', async t => {
  const value = await fixture(t, { targetCount: 38 });
  assert.equal((await verifyLegacyUpgradeDatabaseEvidence(value.input)).mode, 'sameChain');
  changeDatabase(resolve(value.paths.targetDataRoot, 'eky.sqlite'), 'PRAGMA user_version = 99');
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseOriginalContentChanged/);
});

for (const [name, sql, cause] of [
  ['changed old draft value', "UPDATE invoice_drafts SET note = 'changed old value'", 'legacyDatabaseOriginalContentChanged'],
  ['changed old value storage type', "UPDATE invoice_drafts SET note = CAST(note AS BLOB)", 'legacyDatabaseOriginalContentChanged'],
  ['missing old invoice row', "DELETE FROM invoices WHERE id = 'invoice-reopened'", 'legacyDatabaseSchemaInvalid'],
  ['extra old row', `INSERT INTO invoice_drafts(id,company_id,customer_id,status,invoice_date,due_date,payment_term_days,price_input_mode,subject,order_number,note,net_total_cents,vat_total_cents,gross_total_cents,created_at,updated_at)
    SELECT 'extra-draft',company_id,customer_id,status,invoice_date,due_date,payment_term_days,price_input_mode,subject,order_number,note,net_total_cents,vat_total_cents,gross_total_cents,created_at,updated_at FROM invoice_drafts LIMIT 1`, 'legacyDatabaseOriginalContentChanged'],
  ['extra schema table', 'CREATE TABLE extra_table(id INTEGER)', 'legacyDatabaseSchemaInvalid'],
  ['missing immutable trigger with unchanged rows', 'DROP TRIGGER invoice_revision_update_guard', 'legacyDatabaseSchemaInvalid'],
  ['missing old metadata', "DELETE FROM schema_migration_metadata WHERE migration_name LIKE '001_%'", 'legacyDatabaseLedgerInvalid'],
  ['old ledger changed', "UPDATE schema_migrations SET run_at = '2026-09-05T08:00:00.000Z' WHERE name LIKE '001_%'", 'legacyDatabaseLedgerInvalid'],
  ['wrong target build metadata', "UPDATE schema_migration_metadata SET recorded_build_revision = 'cccccccccccc' WHERE migration_name LIKE '039_%'", 'legacyDatabaseLedgerInvalid'],
  ['wrong target release metadata', "UPDATE schema_migration_metadata SET recorded_app_version = '0.2.8' WHERE migration_name LIKE '039_%'", 'legacyDatabaseLedgerInvalid'],
  ['wrong new SQL checksum', "UPDATE schema_migration_metadata SET source_sha256 = printf('%064d',0) WHERE migration_name LIKE '039_%'", 'legacyDatabaseLedgerInvalid'],
  ['wrong new ledger timestamp', "UPDATE schema_migrations SET run_at = '2026-09-05T08:00:00.000Z' WHERE name LIKE '039_%'", 'legacyDatabaseLedgerInvalid'],
  ['noncanonical new timestamp', "UPDATE schema_migrations SET run_at = '2026-09-04T08:00:00Z' WHERE name LIKE '039_%'", 'legacyDatabaseLedgerInvalid'],
  ['missing current revision', "DELETE FROM invoice_current_revisions WHERE invoice_id = 'invoice-one'", 'legacyDatabaseRevisionBindingInvalid'],
  ['current pointer on reopened invoice', `INSERT INTO invoice_current_revisions SELECT company_id,invoice_id,id FROM invoice_content_revisions WHERE invoice_id = 'invoice-reopened'`, 'legacyDatabaseRevisionBindingInvalid'],
  ['valid foreign key pointing at wrong invoice revision', `UPDATE invoice_current_revisions SET revision_id = (SELECT id FROM invoice_content_revisions WHERE invoice_id = 'invoice-reopened') WHERE invoice_id = 'invoice-one'`, 'legacyDatabaseSchemaInvalid'],
]) {
  test(`content proof rejects ${name}`, async t => {
    const value = await fixture(t);
    changeDatabase(resolve(value.paths.targetDataRoot, 'eky.sqlite'), sql);
    await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), error => error.message === cause);
  });
}

for (const [name, guard, sql] of [
  ['snapshot field', 'invoice_revision_update_guard', "UPDATE invoice_content_revisions SET customer_name_snapshot = 'changed snapshot' WHERE invoice_id = 'invoice-one'"],
  ['line content', 'invoice_revision_lines_update_guard', "UPDATE invoice_revision_lines SET description = 'changed line' WHERE line_id = 'line-one'"],
  ['credit origin binding', 'invoice_revision_update_guard', `UPDATE invoice_content_revisions SET credited_invoice_id = 'invoice-reopened',
    credited_revision_id = (SELECT id FROM invoice_content_revisions WHERE invoice_id = 'invoice-reopened'),
    credited_invoice_number_snapshot = '20260002' WHERE invoice_id = 'invoice-credit'`],
  ['missing reopened revision', 'invoice_revision_delete_guard', "DELETE FROM invoice_content_revisions WHERE invoice_id = 'invoice-reopened'"],
  ['unexpected historical VAT', 'invoice_revision_vat_insert_guard', `INSERT INTO invoice_revision_vat_breakdown
    SELECT company_id,invoice_id,id,2500,100,25,125 FROM invoice_content_revisions WHERE invoice_id = 'invoice-one'`],
  ['unproved delivery purpose', 'invoice_delivery_events_binding_no_update', `PRAGMA ignore_check_constraints = ON;
    UPDATE invoice_delivery_events SET send_mode = 'smtpTest'`],
  ['unproved document revision', 'invoice_documents_no_update', `PRAGMA ignore_check_constraints = ON;
    UPDATE invoice_documents SET revision_id = (SELECT id FROM invoice_content_revisions WHERE invoice_id = 'invoice-one')`],
]) {
  test(`content proof rejects ${name} even when the immutable guard is restored`, async t => {
    const value = await fixture(t);
    changeWithoutGuard(resolve(value.paths.targetDataRoot, 'eky.sqlite'), guard, sql);
    await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseRevisionBindingInvalid/);
  });
}

test('every one of the 64 copied header fields is checked without recomputing money', async t => {
  const value = await fixture(t);
  const file = resolve(value.paths.targetDataRoot, 'eky.sqlite');
  const original = await readFile(file);
  for (const field of value.contract.revisionCopyFields) {
    await t.test(field, async () => {
      try {
        const database = new DatabaseSync(toNamespacedPath(file));
        try {
          database.exec('PRAGMA foreign_keys = OFF; PRAGMA ignore_check_constraints = ON');
          const trigger = database.prepare("SELECT sql FROM sqlite_schema WHERE name = 'invoice_revision_update_guard'").get().sql;
          database.exec('DROP TRIGGER invoice_revision_update_guard');
          database.exec(`UPDATE invoice_content_revisions SET "${field}" = CASE typeof("${field}")
            WHEN 'integer' THEN "${field}" + 1 WHEN 'real' THEN "${field}" + 0.5
            WHEN 'null' THEN 'synthetic-change' ELSE 'synthetic-change' END WHERE invoice_id = 'invoice-one'`);
          database.exec(trigger);
        } finally { database.close(); }
        await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input));
      }
      finally { await writeFile(file, original); }
    });
  }
});

test('extra revision for an existing invoice is rejected even with valid foreign keys', async t => {
  const value = await fixture(t);
  const columns = value.contract.targetSchema.find(object => object.name === 'invoice_content_revisions').columns.map(column => column.name);
  changeWithoutGuard(resolve(value.paths.targetDataRoot, 'eky.sqlite'), 'invoice_revision_legacy_insert_guard',
    `INSERT INTO invoice_content_revisions (${columns.map(column => `"${column}"`).join(',')})
    SELECT ${columns.map(column => column === 'id' ? `'${'c'.repeat(32)}'` : `"${column}"`).join(',')}
    FROM invoice_content_revisions WHERE invoice_id = 'invoice-one'`);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseRevisionBindingInvalid/);
});

for (const suffix of ['-wal', '-shm', '-journal']) {
  test(`unresolved ${suffix} is rejected before SQLite opens it`, async t => {
    const value = await fixture(t);
    await writeFile(resolve(value.paths.targetDataRoot, `eky.sqlite${suffix}`), 'synthetic-sidecar');
    await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseReadOnlyInvalid/);
  });
}

test('PDF bytes, size and database catalog closure are required', async t => {
  const value = await fixture(t);
  await writeFile(resolve(value.paths.targetStorageRoot, 'invoices', LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH), '%PDF-changed');
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
});

test('unregistered PDF is not silently ignored', async t => {
  const value = await fixture(t);
  await writeFile(resolve(value.paths.targetStorageRoot, 'unregistered.pdf'), '%PDF-extra');
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
});

test('catalog paths are relative to the module root, not the whole runtime storage', async t => {
  const value = await fixture(t);
  for (const dataRoot of [value.paths.sourceDataRoot, value.paths.targetDataRoot]) {
    const database = new DatabaseSync(toNamespacedPath(resolve(dataRoot, 'eky.sqlite')), { readOnly: true });
    try {
      assert.equal(database.prepare('SELECT storage_path FROM invoice_documents').get().storage_path,
        LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH);
    } finally { database.close(); }
  }
  const files = await createClosedDirectoryInventory(value.paths.targetStorageRoot);
  assert.ok(files.some(entry => entry.relativePath === `invoices/${LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH}`));
  assert.equal((await verifyLegacyUpgradeDatabaseEvidence(value.input)).mode, 'migration038To039');
});

test('matching PDF outside the module root does not satisfy its catalog reference', async t => {
  const value = await fixture(t);
  const outside = resolve(value.paths.targetStorageRoot, LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH);
  await mkdir(resolve(outside, '..'), { recursive: true });
  await rename(resolve(value.paths.targetStorageRoot, 'invoices', LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH), outside);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
});

test('unregistered PDF inside the module root is not silently ignored', async t => {
  const value = await fixture(t);
  await writeFile(resolve(value.paths.targetStorageRoot, 'invoices', 'unregistered.pdf'), '%PDF-extra');
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
});

for (const storagePath of [`invoices/${LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH}`, '../approved-invoice.pdf', '/approved-invoice.pdf']) {
  test(`catalog rejects a non-module-relative reference: ${storagePath}`, async t => {
    const value = await fixture(t);
    const sql = `UPDATE invoice_documents SET storage_path = '${storagePath}'`;
    changeDatabase(resolve(value.paths.sourceDataRoot, 'eky.sqlite'), sql);
    changeWithoutGuard(resolve(value.paths.targetDataRoot, 'eky.sqlite'), 'invoice_documents_no_update', sql);
    await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
  });
}

test('missing referenced PDF is rejected without mutating the remaining storage', async t => {
  const value = await fixture(t);
  await rm(resolve(value.paths.targetStorageRoot, 'invoices', LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH));
  const before = await createClosedDirectoryInventory(value.paths.targetStorageRoot);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
  assert.deepEqual(await createClosedDirectoryInventory(value.paths.targetStorageRoot), before);
});

test('same-size PDF with different bytes still fails its checksum', async t => {
  const value = await fixture(t);
  const file = resolve(value.paths.targetStorageRoot, 'invoices', LEGACY_FIXTURE_DOCUMENT_STORAGE_PATH);
  const bytes = await readFile(file);
  bytes[bytes.length - 1] ^= 1;
  await writeFile(file, bytes);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
});

test('matching PDF checksum cannot hide an incorrect catalog size', async t => {
  const value = await fixture(t);
  const sql = 'UPDATE invoice_documents SET size_bytes = size_bytes + 1';
  changeDatabase(resolve(value.paths.sourceDataRoot, 'eky.sqlite'), sql);
  changeWithoutGuard(resolve(value.paths.targetDataRoot, 'eky.sqlite'), 'invoice_documents_no_update', sql);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseCatalogInvalid/);
});

test('reader-induced file mutation is rejected by the after-close inventory', async t => {
  const value = await fixture(t);
  const close = DatabaseSync.prototype.close;
  let closes = 0;
  t.mock.method(DatabaseSync.prototype, 'close', function () {
    close.call(this);
    if (++closes === 1) appendFileSync(resolve(value.paths.targetDataRoot, 'eky.sqlite'), 'synthetic-mutation');
  });
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence(value.input), /legacyDatabaseReadOnlyInvalid/);
});

test('long Windows database paths use the same readonly proof', async t => {
  const value = await fixture(t, { longPath: true });
  assert.ok(resolve(value.paths.targetDataRoot, 'eky.sqlite').length > 260);
  assert.equal((await verifyLegacyUpgradeDatabaseEvidence(value.input)).mode, 'migration038To039');
});

test('missing or unknown migration package binding fails closed', async t => {
  const value = await fixture(t);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence({ ...value.input, packageBinding: undefined }), /legacyDatabasePackageBindingInvalid/);
  await assert.rejects(verifyLegacyUpgradeDatabaseEvidence({ ...value.input, packageBinding: { ...value.input.packageBinding, migrationCount: 40 } }), /legacyDatabasePackageBindingInvalid/);
});

test('package binding pins installed SQL and the exact packaged runtime build identity', async t => {
  const value = await fixture(t);
  const installRoot = resolve(value.root, 'package');
  const migrationRoot = resolve(installRoot, 'resources/backend/dist/database/migrations');
  await createLegacyDatabasePackageFixture(installRoot);
  const info = { ...TARGET_DATABASE_IDENTITY, schemaVersion: 1, buildDirty: false, buildCreatedAt: '2026-09-04T08:00:00.000Z' };
  const identity = { ...TARGET_DATABASE_IDENTITY, buildRevision: 'b'.repeat(40) };
  await assert.rejects(readFile(resolve(installRoot, 'resources/app/dist/build-info.json')), error => error.code === 'ENOENT');
  const before = await createClosedDirectoryInventory(installRoot);
  assert.deepEqual(await readLegacyDatabasePackageBinding(installRoot, identity), value.input.packageBinding);
  assert.deepEqual(await createClosedDirectoryInventory(installRoot), before);
  await writeLegacyDatabaseBuildInfoFixture(installRoot, { ...info, buildRevision: 'c'.repeat(12) });
  await assert.rejects(readLegacyDatabasePackageBinding(installRoot, identity), /legacyDatabasePackageBindingInvalid/);
  await writeLegacyDatabaseBuildInfoFixture(installRoot, info);
  await writeFile(resolve(migrationRoot, value.contract.migrations[38].fileName), '-- changed SQL');
  await assert.rejects(readLegacyDatabasePackageBinding(installRoot, identity), /legacyDatabasePackageBindingInvalid/);
});

for (const variant of ['missing', 'corrupt', 'oversized']) {
  test(`package binding rejects ${variant} ASAR build-info without unpacked fallback`, async t => {
    const value = await fixture(t);
    const installRoot = resolve(value.root, 'package');
    await createLegacyDatabasePackageFixture(installRoot);
    const info = { ...TARGET_DATABASE_IDENTITY, schemaVersion: 1, buildDirty: false, buildCreatedAt: '2026-09-04T08:00:00.000Z' };
    const fakeRoot = resolve(installRoot, 'resources/app/dist');
    await mkdir(fakeRoot, { recursive: true });
    await writeFile(resolve(fakeRoot, 'build-info.json'), JSON.stringify(info));
    const archive = resolve(installRoot, 'resources/app.asar');
    if (variant === 'missing') await rm(archive);
    if (variant === 'corrupt') await writeFile(archive, 'not-an-asar-archive');
    if (variant === 'oversized') await writeLegacyDatabaseBuildInfoFixture(installRoot, { ...info, padding: 'x'.repeat(128 * 1024) });
    await assert.rejects(readLegacyDatabasePackageBinding(installRoot, TARGET_DATABASE_IDENTITY), /legacyDatabasePackageBindingInvalid/);
  });
}

for (const variant of ['unpacked', 'link', 'directory', 'duplicateKey']) {
  test(`package binding rejects ${variant} ASAR build-info`, async t => {
    const value = await fixture(t);
    const installRoot = resolve(value.root, 'package');
    await createLegacyDatabasePackageFixture(installRoot);
    const info = { ...TARGET_DATABASE_IDENTITY, schemaVersion: 1, buildDirty: false,
      buildCreatedAt: '2026-09-04T08:00:00.000Z' };
    const bytes = Buffer.from(variant === 'duplicateKey'
      ? `{"schemaVersion":1,${JSON.stringify(info).slice(1)}` : JSON.stringify(info));
    const file = { type: 'file', path: 'dist/build-info.json', unpacked: variant === 'unpacked',
      streamGenerator: () => Readable.from([bytes]), stat: { size: bytes.length, mode: 0o100644 } };
    const streams = [{ type: 'directory', path: 'dist', unpacked: false }];
    if (variant === 'directory') streams.push({ type: 'directory', path: file.path, unpacked: false });
    else if (variant === 'link') streams.push({ ...file, path: 'dist/other.json', unpacked: false },
      { type: 'link', path: file.path, symlink: 'other.json', unpacked: false,
        streamGenerator: () => Readable.from([]), stat: { size: 0, mode: 0o120777 } });
    else streams.push(file);
    await createPackageFromStreams(resolve(installRoot, 'resources/app.asar'), streams);
    const before = await createClosedDirectoryInventory(installRoot);
    await assert.rejects(readLegacyDatabasePackageBinding(installRoot, TARGET_DATABASE_IDENTITY),
      /legacyDatabasePackageBindingInvalid/);
    assert.deepEqual(await createClosedDirectoryInventory(installRoot), before);
  });
}
