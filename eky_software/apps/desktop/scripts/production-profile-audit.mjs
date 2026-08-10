import { createHash } from 'node:crypto';
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
} from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const migrationFileNamePattern = /^\d{3}_[A-Za-z0-9_]+\.sql$/;
const migrationIdentityDomain = 'Eky migration chain v1\0';
const pdfSignature = Buffer.from('%PDF-', 'ascii');
const sha256Pattern = /^[a-f0-9]{64}$/;
const auditTables = Object.freeze([
  'customer_audit_events',
  'company_settings_audit_events',
  'company_email_secret_audit_events',
  'invoice_audit_events',
  'invoice_settings_audit_events',
  'local_runtime_identity',
]);
const companyTables = Object.freeze([
  'local_runtime_identity',
  'company_settings',
  'customers',
  'invoice_drafts',
  'invoice_numbering_settings',
  'invoice_number_sequences',
  'invoice_payment_settings',
  'invoice_vat_rates',
  'invoices',
  'invoice_audit_events',
  'invoice_documents',
  'invoice_delivery_events',
  'invoice_payment_events',
  'company_email_secret_audit_events',
  'customer_audit_events',
  'company_settings_audit_events',
  'invoice_settings_audit_events',
]);
const restoreJournalPhases = new Set([
  'prepared',
  'movingCurrentDatabase',
  'currentDatabaseMoved',
  'movingCurrentDocuments',
  'currentDocumentsMoved',
  'activatingStagedDatabase',
  'stagedDatabaseActivated',
  'activatingStagedDocuments',
  'stagedDocumentsActivated',
  'validationStarting',
  'accepted',
  'rollbackStarting',
  'rolledBack',
  'failedSafe',
]);

export async function createProductionProfileAudit(input) {
  const report = createEmptyReport();
  const profileRoot = resolve(input.profileRoot);
  const runtimeRoot = join(profileRoot, 'runtime');
  const databasePath = join(runtimeRoot, 'data', 'eky.sqlite');
  const storageRoot = join(runtimeRoot, 'storage', 'invoices');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'eky-profile-audit-'));

  try {
    report.profileRootExists = await isDirectory(profileRoot);
    report.databaseExists = await isRegularFile(databasePath);
    report.secretConfigured = await isRegularFile(
      join(runtimeRoot, 'secrets', 'company-email-smtp-v1.dat'),
    );
    report.recoveryPointCount = await countRegularEntries(
      join(runtimeRoot, 'recovery-points'),
    );
    report.restoreJournalState = await readRestoreJournalState(
      join(
        runtimeRoot,
        'profile-restore-state',
        'profile-restore-activation-journal-v1.json',
      ),
    );

    if (!report.profileRootExists && !report.databaseExists) {
      report.classification = 'clean-empty';
      return freezeReport(report);
    }
    if (!report.databaseExists) {
      report.classification = 'unhealthy';
      return freezeReport(report);
    }

    const copiedDatabasePath = join(temporaryRoot, 'eky.sqlite');
    await copyRegularFile(databasePath, copiedDatabasePath);
    for (const suffix of ['-wal', '-shm']) {
      const source = `${databasePath}${suffix}`;
      if (await pathExists(source)) {
        await copyRegularFile(source, `${copiedDatabasePath}${suffix}`);
      }
    }
    const copiedStorageRoot = join(temporaryRoot, 'storage', 'invoices');
    if (await pathExists(storageRoot)) {
      await copyClosedTree(storageRoot, copiedStorageRoot);
    }

    report.databaseByteSize = (await lstat(copiedDatabasePath)).size;
    const database = new DatabaseSync(copiedDatabasePath, {
      readOnly: true,
    });
    try {
      database.exec('PRAGMA query_only = ON');
      const integrity = database.prepare('PRAGMA integrity_check').get();
      const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
      report.integrityCheck = integrity?.integrity_check === 'ok' ? 'ok' : 'failed';
      report.foreignKeyCheck = foreignKeys.length === 0 ? 'ok' : 'failed';

      const migrations = await readMigrationChain(input.migrationsDirectory);
      const appliedMigrations = database
        .prepare('SELECT name FROM schema_migrations ORDER BY name')
        .all()
        .map((row) => row.name);
      report.migrationCount = appliedMigrations.length;
      report.latestMigrationName = appliedMigrations.at(-1) ?? null;
      report.migrationChainIdentity = migrations.identity;
      report.migrationChainMatches = arraysEqual(
        appliedMigrations,
        migrations.fileNames,
      );
      report.localRuntimeIdentitySingletonCount = readCount(
        database,
        'SELECT count(*) AS count FROM local_runtime_identity WHERE singleton_key = ?',
        ['local-runtime'],
      );
      report.distinctCompanyIdCount = readDistinctCompanyCount(database);
      report.companySettingsConfigured =
        readCount(database, 'SELECT count(*) AS count FROM company_settings') > 0;
      report.customerRowCount = readCount(
        database,
        'SELECT count(*) AS count FROM customers',
      );
      report.draftRowCount = readCount(
        database,
        'SELECT count(*) AS count FROM invoice_drafts',
      );
      report.approvedInvoiceCount = readCount(
        database,
        "SELECT count(*) AS count FROM invoices WHERE status = 'approved'",
      );
      report.sentInvoiceCount = readCount(
        database,
        "SELECT count(*) AS count FROM invoices WHERE status = 'sent'",
      );
      report.creditInvoiceCount = readCount(
        database,
        "SELECT count(*) AS count FROM invoices WHERE invoice_kind = 'credit'",
      );
      report.paymentEventCount = readCount(
        database,
        'SELECT count(*) AS count FROM invoice_payment_events',
      );
      report.auditEventCounts = Object.freeze(
        Object.fromEntries(
          auditTables.map((table) => [
            table,
            readCount(database, `SELECT count(*) AS count FROM ${table}`),
          ]),
        ),
      );

      Object.assign(
        report,
        await inspectPdfClosure(database, copiedStorageRoot),
      );
      report.classification = classifyProfile(database, report);
    } finally {
      database.close();
    }

    return freezeReport(report);
  } catch {
    report.classification = 'unhealthy';
    return freezeReport(report);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

function createEmptyReport() {
  return {
    approvedInvoiceCount: 0,
    auditEventCounts: Object.freeze({}),
    authoritativePdfCount: 0,
    classification: 'mixed-or-uncertain',
    companySettingsConfigured: false,
    creditInvoiceCount: 0,
    customerRowCount: 0,
    databaseByteSize: 0,
    databaseExists: false,
    distinctCompanyIdCount: 0,
    draftRowCount: 0,
    foreignKeyCheck: 'not-run',
    integrityCheck: 'not-run',
    latestMigrationName: null,
    localRuntimeIdentitySingletonCount: 0,
    migrationChainIdentity: null,
    migrationChainMatches: false,
    migrationCount: 0,
    missingReferencedPdfCount: 0,
    orphanPdfCount: 0,
    paymentEventCount: 0,
    pdfHashSizeClosure: 'invalid',
    profileRootExists: false,
    recoveryPointCount: 0,
    restoreJournalState: 'absent',
    secretConfigured: false,
    sentInvoiceCount: 0,
    updateJournalState: 'not-implemented',
  };
}

function freezeReport(report) {
  return Object.freeze({
    ...report,
    auditEventCounts: Object.freeze({ ...report.auditEventCounts }),
  });
}

function readCount(database, sql, parameters = []) {
  const row = database.prepare(sql).get(...parameters);
  if (!Number.isSafeInteger(row?.count) || row.count < 0) {
    throw new Error('PROFILE_AUDIT_COUNT_INVALID');
  }
  return row.count;
}

function readDistinctCompanyCount(database) {
  const union = companyTables
    .map((table) => `SELECT company_id FROM ${table}`)
    .join(' UNION ');
  return readCount(
    database,
    `SELECT count(*) AS count FROM (${union}) WHERE company_id IS NOT NULL`,
  );
}

async function inspectPdfClosure(database, storageRoot) {
  const documents = database
    .prepare(
      `
        SELECT storage_path, sha256, size_bytes
        FROM invoice_documents
        ORDER BY id
      `,
    )
    .all();
  const referencedPaths = new Set();
  let missingReferencedPdfCount = 0;
  let valid = true;

  for (const document of documents) {
    if (
      !isSafeStoragePath(document.storage_path) ||
      typeof document.sha256 !== 'string' ||
      !sha256Pattern.test(document.sha256) ||
      !Number.isSafeInteger(document.size_bytes) ||
      document.size_bytes <= 0
    ) {
      valid = false;
      continue;
    }
    referencedPaths.add(document.storage_path);
    const filePath = resolve(storageRoot, ...document.storage_path.split('/'));
    if (!isContained(storageRoot, filePath) || !(await isRegularFile(filePath))) {
      missingReferencedPdfCount += 1;
      valid = false;
      continue;
    }
    const inspected = await inspectPdf(filePath);
    if (
      inspected.size !== document.size_bytes ||
      inspected.sha256 !== document.sha256
    ) {
      valid = false;
    }
  }

  const storedPdfs = await listPdfLogicalPaths(storageRoot);
  const orphanPdfCount = storedPdfs.filter(
    (logicalPath) => !referencedPaths.has(logicalPath),
  ).length;
  if (orphanPdfCount > 0) {
    valid = false;
  }

  return {
    authoritativePdfCount: documents.length,
    missingReferencedPdfCount,
    orphanPdfCount,
    pdfHashSizeClosure: valid ? 'valid' : 'invalid',
  };
}

async function inspectPdf(filePath) {
  const hash = createHash('sha256');
  let signature = Buffer.alloc(0);
  let size = 0;
  for await (const chunk of createReadStream(filePath)) {
    const content = Buffer.from(chunk);
    if (size === 0) {
      signature = content.subarray(0, pdfSignature.byteLength);
    }
    size += content.byteLength;
    hash.update(content);
  }
  if (!signature.equals(pdfSignature)) {
    throw new Error('PROFILE_AUDIT_PDF_INVALID');
  }
  return { sha256: hash.digest('hex'), size };
}

async function listPdfLogicalPaths(root) {
  if (!(await isDirectory(root))) {
    return [];
  }
  const result = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error('PROFILE_AUDIT_ARTIFACT_INVALID');
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (!entry.isFile()) {
        throw new Error('PROFILE_AUDIT_ARTIFACT_INVALID');
      } else if (entry.name.toLowerCase().endsWith('.pdf')) {
        result.push(relative(root, path).split(sep).join('/'));
      }
    }
  };
  await visit(root);
  return result;
}

function classifyProfile(database, report) {
  if (
    report.integrityCheck !== 'ok' ||
    report.foreignKeyCheck !== 'ok' ||
    !report.migrationChainMatches ||
    report.localRuntimeIdentitySingletonCount !== 1 ||
    report.distinctCompanyIdCount !== 1 ||
    report.pdfHashSizeClosure !== 'valid' ||
    report.restoreJournalState === 'invalid' ||
    report.restoreJournalState === 'recovery-required'
  ) {
    return 'unhealthy';
  }

  const businessRowCount =
    report.customerRowCount +
    report.draftRowCount +
    readCount(database, 'SELECT count(*) AS count FROM invoices');
  if (!report.companySettingsConfigured && businessRowCount === 0) {
    return 'clean-empty';
  }

  const markerSummary = readSyntheticMarkerSummary(database);
  if (markerSummary.marked > 0 && markerSummary.unmarked > 0) {
    return 'mixed-or-uncertain';
  }
  if (markerSummary.marked > 0) {
    return 'synthetic/test-data-present';
  }
  return 'pilot-data-present';
}

function readSyntheticMarkerSummary(database) {
  const marker = `
    lower(search_text) LIKE '%test%'
    OR lower(search_text) LIKE '%example%'
    OR lower(search_text) LIKE '%dummy%'
    OR lower(search_text) LIKE '%synthetic%'
    OR lower(search_text) LIKE '%smoke%'
    OR lower(search_text) LIKE '%dev-company%'
    OR lower(search_text) LIKE '%e2e%'
  `;
  const row = database
    .prepare(
      `
        WITH identity_rows(search_text) AS (
          SELECT company_id || ' ' || company_name || ' ' || email
          FROM company_settings
          UNION ALL
          SELECT company_id || ' ' || name || ' ' || email || ' ' || comment
          FROM customers
          UNION ALL
          SELECT company_id || ' ' || subject || ' ' || note
          FROM invoice_drafts
          UNION ALL
          SELECT company_id || ' ' || customer_name_snapshot || ' ' || subject || ' ' || note
          FROM invoices
        )
        SELECT
          sum(CASE WHEN ${marker} THEN 1 ELSE 0 END) AS marked,
          sum(CASE WHEN ${marker} THEN 0 ELSE 1 END) AS unmarked
        FROM identity_rows
      `,
    )
    .get();
  return {
    marked: Number.isSafeInteger(row?.marked) ? row.marked : 0,
    unmarked: Number.isSafeInteger(row?.unmarked) ? row.unmarked : 0,
  };
}

async function readMigrationChain(directory) {
  const fileNames = (await readdir(resolve(directory)))
    .filter((fileName) => fileName.endsWith('.sql'))
    .sort();
  const hash = createHash('sha256').update(migrationIdentityDomain, 'utf8');
  for (const fileName of fileNames) {
    if (!migrationFileNamePattern.test(fileName)) {
      throw new Error('PROFILE_AUDIT_MIGRATION_INVALID');
    }
    const content = await readFile(join(resolve(directory), fileName));
    const encodedName = Buffer.from(fileName, 'utf8');
    const lengths = Buffer.alloc(8);
    lengths.writeUInt32BE(encodedName.byteLength, 0);
    lengths.writeUInt32BE(content.byteLength, 4);
    hash.update(lengths).update(encodedName).update(content);
  }
  return { fileNames, identity: hash.digest('hex') };
}

async function readRestoreJournalState(path) {
  if (!(await pathExists(path))) {
    return 'absent';
  }
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (
      !isRecord(value) ||
      value.formatVersion !== 1 ||
      typeof value.phase !== 'string' ||
      !restoreJournalPhases.has(value.phase)
    ) {
      return 'invalid';
    }
    if (value.phase === 'failedSafe') {
      return 'recovery-required';
    }
    if (value.phase === 'accepted' || value.phase === 'rolledBack') {
      return 'completed';
    }
    return 'in-progress';
  } catch {
    return 'invalid';
  }
}

async function copyClosedTree(source, target) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('PROFILE_AUDIT_SOURCE_INVALID');
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { dereference: false, recursive: true });
}

async function copyRegularFile(source, target) {
  const metadata = await lstat(source);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error('PROFILE_AUDIT_SOURCE_INVALID');
  }
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { dereference: false, force: false });
}

async function countRegularEntries(path) {
  if (!(await isDirectory(path))) {
    return 0;
  }
  const entries = await readdir(path, { withFileTypes: true });
  return entries.filter(
    (entry) =>
      !entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()),
  ).length;
}

function isSafeStoragePath(value) {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.includes('\\') &&
    !value.startsWith('/') &&
    value
      .split('/')
      .every(
        (segment) => segment !== '' && segment !== '.' && segment !== '..',
      )
  );
}

function isContained(root, candidate) {
  const normalizedRoot = `${resolve(root)}${sep}`;
  return resolve(candidate).startsWith(normalizedRoot);
}

async function isDirectory(path) {
  try {
    const metadata = await lstat(path);
    return metadata.isDirectory() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function isRegularFile(path) {
  try {
    const metadata = await lstat(path);
    return metadata.isFile() && !metadata.isSymbolicLink();
  } catch {
    return false;
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
