import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, toNamespacedPath } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { readMigrationManifest } from '../../../backend/src/database/migration/migrationManifest.ts';
import { parseDesktopBuildInfo } from '../../src/release/desktopBuildInfo.ts';
import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

export const LEGACY_DATABASE_ERROR_CODES = Object.freeze({
  legacyDatabasePackageBindingInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_PACKAGE_BINDING_INVALID',
  legacyDatabaseSchemaInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_SCHEMA_INVALID',
  legacyDatabaseLedgerInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_LEDGER_INVALID',
  legacyDatabaseOriginalContentChanged: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_ORIGINAL_CONTENT_CHANGED',
  legacyDatabaseRevisionBindingInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_REVISION_BINDING_INVALID',
  legacyDatabaseCatalogInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_CATALOG_INVALID',
  legacyDatabaseReadOnlyInvalid: 'WINDOWS_ACCEPTANCE_LEGACY_DATABASE_READ_ONLY_INVALID',
});
const contractPath = new URL('./legacyUpgradeDatabase038To039.contract.json', import.meta.url);
const CONTRACT_MAXIMUM_BYTES = 256 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const serialized = value => JSON.stringify(value, (_, entry) =>
  typeof entry === 'bigint' ? { integer: entry.toString() } :
  ArrayBuffer.isView(entry) ? { blob: Buffer.from(entry).toString('base64') } : entry);
const equal = (left, right) => serialized(left) === serialized(right);
const fail = code => { throw new Error(code); };
const quoted = name => `"${name.replaceAll('"', '""')}"`;
const canonicalTime = value => typeof value === 'string' && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;

export async function readLegacyDatabaseContract() {
  const bytes = await readFile(contractPath);
  const contract = parseStrictJsonObjectBytes(bytes, {
    errorCode: 'legacyDatabasePackageBindingInvalid', maximumBytes: CONTRACT_MAXIMUM_BYTES,
  });
  if (!hasKeys(contract, ['schemaVersion', 'migrations', 'sourceSchema', 'targetSchema', 'revisionCopyFields']) ||
      contract.schemaVersion !== 1 || !Array.isArray(contract.migrations) || contract.migrations.length !== 39 ||
      !contract.migrations.every((entry, index) => hasKeys(entry, ['fileName', 'sourceSha256', 'chainSha256']) &&
        typeof entry.fileName === 'string' && entry.fileName.startsWith(`${String(index + 1).padStart(3, '0')}_`) &&
        /^\d{3}_[a-z0-9_]+\.sql$/.test(entry.fileName) &&
        [entry.sourceSha256, entry.chainSha256].every(isSha256)) ||
      contract.migrations[38].fileName !== '039_add_invoice_content_revisions.sql' ||
      ![contract.sourceSchema, contract.targetSchema].every(validSchemaContract) ||
      !Array.isArray(contract.revisionCopyFields) || contract.revisionCopyFields.length !== 64 ||
      new Set(contract.revisionCopyFields).size !== 64 ||
      !contract.revisionCopyFields.every(name => typeof name === 'string' && /^[a-z][a-z0-9_]*$/.test(name))) {
    fail('legacyDatabasePackageBindingInvalid');
  }
  return { contract, contractSha256: hash(bytes) };
}

function hasKeys(value, keys) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(',');
}

function isSha256(value) { return typeof value === 'string' && sha256Pattern.test(value); }

function validSchemaContract(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  const identities = new Set();
  return value.every(object => {
    if (!hasKeys(object, ['type', 'name', 'table', 'sqlSha256', 'columns']) ||
        !['table', 'index', 'trigger', 'view'].includes(object.type) ||
        ![object.name, object.table].every(name => typeof name === 'string' && name.length > 0) ||
        (object.sqlSha256 !== null && !isSha256(object.sqlSha256)) || identities.has(`${object.type}:${object.name}`)) return false;
    identities.add(`${object.type}:${object.name}`);
    if (object.type !== 'table') return object.columns === null;
    return Array.isArray(object.columns) && object.columns.length > 0 && object.columns.every((column, index) =>
      hasKeys(column, ['cid', 'name', 'type', 'notnull', 'dflt_value', 'pk', 'hidden']) && column.cid === index &&
      typeof column.name === 'string' && column.name.length > 0 && typeof column.type === 'string' &&
      [0, 1].includes(column.notnull) && Number.isSafeInteger(column.pk) && column.pk >= 0 &&
      [0, 1, 2, 3].includes(column.hidden) && (column.dflt_value === null || typeof column.dflt_value === 'string'));
  });
}

export function isLegacyDatabaseProof(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).sort().join(',') !== 'appVersion,buildRevision,contractSha256,mode,schemaVersion,sourceChainSha256,targetChainSha256') return false;
  return value.schemaVersion === 1 && ['sameChain', 'migration038To039'].includes(value.mode) &&
    typeof value.appVersion === 'string' && /^\d+\.\d+\.\d+$/.test(value.appVersion) &&
    typeof value.buildRevision === 'string' && /^[0-9a-f]{7,40}$/.test(value.buildRevision) &&
    [value.contractSha256, value.sourceChainSha256, value.targetChainSha256].every(isSha256);
}

// The caller must verify the whole installed payload before deriving this binding.
// SQL bytes are then pinned to the reviewed contract, never to a live profile.
export async function readLegacyDatabasePackageBinding(installRoot, identity) {
  try {
    const { contract, contractSha256 } = await readLegacyDatabaseContract();
    const manifest = readMigrationManifest(resolve(installRoot, 'resources', 'backend', 'dist', 'database', 'migrations'));
    if (![38, 39].includes(manifest.length) || !equal(manifest.map(({ fileName, sourceSha256, chainSha256 }) =>
      ({ fileName, sourceSha256, chainSha256 })), contract.migrations.slice(0, manifest.length))) {
      fail('legacyDatabasePackageBindingInvalid');
    }
    const buildInfo = parseDesktopBuildInfo(JSON.parse(await readFile(
      resolve(installRoot, 'resources', 'app', 'dist', 'build-info.json'), 'utf8')),
    { expectedAppVersion: identity.appVersion });
    if (buildInfo.buildDirty || !identity.buildRevision.startsWith(buildInfo.buildRevision)) {
      fail('legacyDatabasePackageBindingInvalid');
    }
    return Object.freeze({ contractSha256, migrationCount: manifest.length,
      migrationChainSha256: manifest.at(-1).chainSha256,
      appVersion: buildInfo.appVersion, buildRevision: buildInfo.buildRevision });
  } catch { fail('legacyDatabasePackageBindingInvalid'); }
}

export function snapshotLegacyDatabaseSchema(database) {
  const objects = database.prepare('SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name').all();
  return objects.map(({ type, name, tbl_name, sql }) => ({ type, name, table: tbl_name,
    sqlSha256: sql === null ? null : hash(Buffer.from(sql)),
    columns: type === 'table' ? database.prepare(`PRAGMA table_xinfo(${quoted(name)})`).all().map(row => ({ ...row })) : null,
  }));
}

function typedCell(type, value) {
  if (type === 'null') return [type, null];
  if (type === 'integer') return [type, value.toString()];
  if (type === 'blob') return [type, Buffer.from(value).toString('base64')];
  if (type === 'real') {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleBE(value);
    return [type, bytes.toString('hex')];
  }
  if (type === 'text') return [type, value];
  fail('legacyDatabaseOriginalContentChanged');
}

function rows(database, table, columns, filter = '') {
  const projection = columns.flatMap(column => [`typeof(${quoted(column)})`, quoted(column)]).join(',');
  const statement = database.prepare(`SELECT ${projection} FROM ${quoted(table)} ${filter}`);
  statement.setReadBigInts(true);
  statement.setReturnArrays(true);
  return statement.all().map(row => columns.map((_, index) => typedCell(row[index * 2], row[index * 2 + 1])));
}

function multiset(value) { return value.map(row => JSON.stringify(row)).sort(); }
function requireRows(actual, expected, code) { if (!equal(multiset(actual), multiset(expected))) fail(code); }

function objectRows(database, table) {
  const statement = database.prepare(`SELECT * FROM ${quoted(table)}`);
  statement.setReadBigInts(true);
  return statement.all();
}

function validateLedger(database, migrations) {
  const history = database.prepare('SELECT name, run_at FROM schema_migrations ORDER BY name').all();
  const metadata = database.prepare('SELECT * FROM schema_migration_metadata ORDER BY migration_name').all();
  if (history.length !== migrations.length || metadata.length !== migrations.length) fail('legacyDatabaseLedgerInvalid');
  history.forEach((row, index) => {
    const entry = migrations[index];
    const meta = metadata[index];
    if (row.name !== entry.fileName || !canonicalTime(row.run_at) || meta.migration_name !== row.name ||
        meta.metadata_version !== 1 || meta.source_sha256 !== entry.sourceSha256 ||
        meta.chain_sha256 !== entry.chainSha256 || !['applied', 'legacy_baseline'].includes(meta.metadata_origin) ||
        !canonicalTime(meta.recorded_at) || !/^[A-Za-z0-9.+_-]{1,80}$/.test(meta.recorded_app_version) ||
        !/^(?:[0-9a-f]{7,40}|development)$/.test(meta.recorded_build_revision)) fail('legacyDatabaseLedgerInvalid');
  });
  return { history, metadata };
}

function validateOriginalContent(source, target, contract, binding) {
  validateLedger(source, contract.migrations.slice(0, 38));
  const targetLedger = validateLedger(target, contract.migrations.slice(0, binding.migrationCount));
  if (binding.migrationCount === 39) {
    const entry = contract.migrations[38];
    const meta = targetLedger.metadata[38];
    if (meta.metadata_origin !== 'applied' || meta.recorded_at !== targetLedger.history[38].run_at ||
        meta.recorded_app_version !== binding.appVersion || meta.recorded_build_revision !== binding.buildRevision ||
        meta.source_sha256 !== entry.sourceSha256 || meta.chain_sha256 !== binding.migrationChainSha256) fail('legacyDatabaseLedgerInvalid');
  }
  const tableSchemas = contract.sourceSchema.filter(object => object.type === 'table');
  for (const table of tableSchemas) {
    const columns = table.columns.map(column => column.name);
    const ledgerColumn = table.name === 'schema_migrations' ? 'name' : table.name === 'schema_migration_metadata' ? 'migration_name' : null;
    const filter = ledgerColumn && binding.migrationCount === 39
      ? `WHERE ${quoted(ledgerColumn)} <> '039_add_invoice_content_revisions.sql'` : '';
    requireRows(rows(target, table.name, columns, filter), rows(source, table.name, columns),
      ledgerColumn ? 'legacyDatabaseLedgerInvalid' : 'legacyDatabaseOriginalContentChanged');
  }
}

function validateRevisionBindings(source, target, contract) {
  const invoices = objectRows(source, 'invoices');
  const revisions = objectRows(target, 'invoice_content_revisions');
  const byInvoice = new Map();
  const usedIds = new Set();
  if (revisions.length !== invoices.length) fail('legacyDatabaseRevisionBindingInvalid');
  for (const revision of revisions) {
    if (typeof revision.id !== 'string' || !/^[0-9a-f]{32}$/.test(revision.id) || usedIds.has(revision.id) ||
        byInvoice.has(revision.invoice_id)) fail('legacyDatabaseRevisionBindingInvalid');
    usedIds.add(revision.id);
    byInvoice.set(revision.invoice_id, revision);
  }
  for (const invoice of invoices) {
    const revision = byInvoice.get(invoice.id);
    const original = invoice.credited_invoice_id === null ? null : byInvoice.get(invoice.credited_invoice_id);
    const originalInvoice = invoice.credited_invoice_id === null ? null : invoices.find(row => row.id === invoice.credited_invoice_id);
    if (!revision || revision.company_id !== invoice.company_id || revision.origin !== 'legacySnapshot' ||
        revision.vat_breakdown_state !== 'unavailable' ||
        !contract.revisionCopyFields.every(field => equal(revision[field], invoice[field])) ||
        revision.credited_revision_id !== (original?.id ?? null) ||
        revision.credited_invoice_number_snapshot !== (originalInvoice?.invoice_number ?? null) ||
        revision.credited_invoice_date_snapshot !== (originalInvoice?.invoice_date ?? null) ||
        (original && original.company_id !== invoice.company_id)) fail('legacyDatabaseRevisionBindingInvalid');
  }
  const lineColumns = contract.targetSchema.find(object => object.type === 'table' && object.name === 'invoice_revision_lines').columns.map(column => column.name);
  const expectedLines = objectRows(source, 'invoice_lines').map(line => {
    const revision = byInvoice.get(line.invoice_id);
    const sourceRevision = revision?.credited_revision_id ?? null;
    if (!revision) fail('legacyDatabaseRevisionBindingInvalid');
    return Object.fromEntries(lineColumns.map(field => [field,
      field === 'company_id' ? revision.company_id : field === 'revision_id' ? revision.id :
      field === 'line_id' ? line.id : field === 'source_revision_id' ? (line.source_invoice_line_id === null ? null : sourceRevision) : line[field]]));
  });
  // Old line fields were type-checked above; new values are checked with SQL storage types too.
  const expectedTypedLines = expectedLines.map(row => lineColumns.map(column => {
    const value = row[column];
    return typedCell(value === null ? 'null' : typeof value === 'bigint' ? 'integer' :
      typeof value === 'number' ? 'real' : ArrayBuffer.isView(value) ? 'blob' : 'text', value);
  }));
  requireRows(rows(target, 'invoice_revision_lines', lineColumns), expectedTypedLines, 'legacyDatabaseRevisionBindingInvalid');
  const pointers = objectRows(target, 'invoice_current_revisions');
  const expectedPointers = invoices.filter(row => row.status !== 'reopened_for_edit').map(row => ({
    company_id: row.company_id, invoice_id: row.id, revision_id: byInvoice.get(row.id).id,
  }));
  requireRows(pointers.map(row => [row.company_id, row.invoice_id, row.revision_id]),
    expectedPointers.map(row => [row.company_id, row.invoice_id, row.revision_id]), 'legacyDatabaseRevisionBindingInvalid');
  if (objectRows(target, 'invoice_revision_vat_breakdown').length !== 0) fail('legacyDatabaseRevisionBindingInvalid');
  for (const row of objectRows(target, 'invoice_documents')) {
    if (row.binding_kind !== 'legacyOriginal' || row.revision_id !== null || row.source_document_id !== null) fail('legacyDatabaseRevisionBindingInvalid');
  }
  for (const row of objectRows(target, 'invoice_delivery_events')) {
    if (row.binding_kind !== 'legacyOriginal' || row.revision_id !== null || row.send_mode !== 'legacyUnknown' ||
        row.document_sha256 !== null || row.document_size_bytes !== null) fail('legacyDatabaseRevisionBindingInvalid');
  }
}

function validateCatalog(database, inventory) {
  const files = inventory.filter(entry => entry.kind === 'file');
  const used = new Set();
  for (const document of objectRows(database, 'invoice_documents')) {
    const file = files.find(entry => entry.relativePath === document.storage_path);
    if (!file || used.has(document.storage_path) || document.document_type !== 'approved_invoice_pdf' ||
        document.mime_type !== 'application/pdf' || file.sha256 !== document.sha256 ||
        BigInt(file.size) !== document.size_bytes) fail('legacyDatabaseCatalogInvalid');
    used.add(document.storage_path);
  }
  if (files.length !== used.size) fail('legacyDatabaseCatalogInvalid');
}

async function filesystemSnapshot(roots) {
  const inventories = [];
  const identities = [];
  for (const root of roots) {
    const inventory = await createClosedDirectoryInventory(root);
    inventories.push(inventory);
    for (const entry of [{ relativePath: '', kind: 'directory' }, ...inventory]) {
      const metadata = await lstat(resolve(root, entry.relativePath), { bigint: true });
      identities.push([metadata.dev, metadata.ino, metadata.nlink, metadata.size,
        metadata.mtimeNs, metadata.ctimeNs].map(value => value.toString()));
    }
  }
  return { inventories, identities };
}

export async function verifyLegacyUpgradeDatabaseEvidence({ sourceDataRoot, sourceStorageRoot, targetDataRoot, targetStorageRoot, packageBinding }) {
  let source;
  let target;
  let before;
  let result;
  let failure;
  const roots = [sourceDataRoot, sourceStorageRoot, targetDataRoot, targetStorageRoot];
  try {
    const { contract, contractSha256 } = await readLegacyDatabaseContract();
    if (!hasKeys(packageBinding, ['contractSha256', 'migrationCount', 'migrationChainSha256', 'appVersion', 'buildRevision']) ||
        packageBinding.contractSha256 !== contractSha256 ||
        ![38, 39].includes(packageBinding.migrationCount) ||
        packageBinding.migrationChainSha256 !== contract.migrations[packageBinding.migrationCount - 1].chainSha256 ||
        typeof packageBinding.appVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(packageBinding.appVersion) ||
        typeof packageBinding.buildRevision !== 'string' || !/^[0-9a-f]{7,40}$/.test(packageBinding.buildRevision)) fail('legacyDatabasePackageBindingInvalid');
    before = await filesystemSnapshot(roots);
    for (const inventory of [before.inventories[0], before.inventories[2]]) {
      if (inventory.some(entry => /^eky\.sqlite-(?:wal|shm|journal)$/i.test(entry.relativePath))) fail('legacyDatabaseReadOnlyInvalid');
      const database = inventory.find(entry => entry.relativePath === 'eky.sqlite' && entry.kind === 'file');
      if (!database) fail('legacyDatabaseReadOnlyInvalid');
    }
    source = new DatabaseSync(toNamespacedPath(resolve(sourceDataRoot, 'eky.sqlite')), { readOnly: true });
    target = new DatabaseSync(toNamespacedPath(resolve(targetDataRoot, 'eky.sqlite')), { readOnly: true });
    for (const database of [source, target]) {
      if (database.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || database.prepare('PRAGMA foreign_key_check').all().length) fail('legacyDatabaseSchemaInvalid');
    }
    if (!equal(snapshotLegacyDatabaseSchema(source), contract.sourceSchema) ||
        !equal(snapshotLegacyDatabaseSchema(target), packageBinding.migrationCount === 38 ? contract.sourceSchema : contract.targetSchema)) fail('legacyDatabaseSchemaInvalid');
    validateOriginalContent(source, target, contract, packageBinding);
    if (packageBinding.migrationCount === 39) validateRevisionBindings(source, target, contract);
    else if (!inventoriesMatch(before.inventories[0], before.inventories[2])) fail('legacyDatabaseOriginalContentChanged');
    validateCatalog(source, before.inventories[1]);
    validateCatalog(target, before.inventories[3]);
    result = Object.freeze({ schemaVersion: 1, contractSha256, mode: packageBinding.migrationCount === 39 ? 'migration038To039' : 'sameChain',
      sourceChainSha256: contract.migrations[37].chainSha256, targetChainSha256: packageBinding.migrationChainSha256,
      appVersion: packageBinding.appVersion, buildRevision: packageBinding.buildRevision });
  } catch (error) {
    failure = Object.hasOwn(LEGACY_DATABASE_ERROR_CODES, error?.message) ? error : new Error('legacyDatabaseReadOnlyInvalid');
  } finally {
    for (const database of [target, source]) {
      try { database?.close(); } catch { failure ??= new Error('legacyDatabaseReadOnlyInvalid'); }
    }
    if (before) {
      try {
        if (!equal(before, await filesystemSnapshot(roots))) failure ??= new Error('legacyDatabaseReadOnlyInvalid');
      } catch { failure ??= new Error('legacyDatabaseReadOnlyInvalid'); }
    }
  }
  if (failure) throw failure;
  return result;
}
