import { createHash } from 'node:crypto';
import {
  createReadStream,
  promises as fileSystem,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import type { InvoiceBackupArtifactCatalogItem } from '../../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';

const artifactCatalogLogicalPath = 'snapshot-catalog-v1.json';
const artifactOwner = 'invoicing';
const maximumArtifactCatalogBytes = 64 * 1024 * 1024;
const maximumArtifactCount = 100_000;
const maximumInvoicePdfBytes = 10 * 1024 * 1024;
const maximumProfileArtifactBytes = 20 * 1024 * 1024 * 1024;
const maximumTextBytes = 1_024;
const pdfSignature = Buffer.from('%PDF-', 'ascii');
const sha256Pattern = /^[a-f0-9]{64}$/;

interface StagedArtifactCatalogEntry {
  byteSize: number;
  fileName: string;
  logicalPath: string;
  mediaType: 'application/pdf';
  owner: typeof artifactOwner;
  restoreValidationIdentity: {
    companyId: string;
    documentId: string;
    documentType: 'approved_invoice_pdf';
    invoiceId: string;
    storagePath: string;
  };
  sha256: string;
  sourceIdentity: {
    companyId: string;
    documentId: string;
    invoiceId: string;
    storagePath: string;
  };
}

export interface ProfileArtifactCatalogValidation {
  artifactCount: number;
  artifactTotalByteSize: number;
}

export async function validateProfileArtifactCatalog(input: {
  database: DatabaseConnection;
  operationRoot: string;
}): Promise<ProfileArtifactCatalogValidation> {
  const catalogPath = join(
    input.operationRoot,
    artifactCatalogLogicalPath,
  );
  assertContainedPath(input.operationRoot, catalogPath);
  const catalogMetadata = await fileSystem.lstat(catalogPath);

  if (
    !catalogMetadata.isFile() ||
    catalogMetadata.isSymbolicLink() ||
    catalogMetadata.nlink !== 1 ||
    catalogMetadata.size < 1 ||
    catalogMetadata.size > maximumArtifactCatalogBytes
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  const catalog = parseArtifactCatalog(
    await fileSystem.readFile(catalogPath),
  );
  const expectedItems =
    await new SqliteInvoiceBackupArtifactCatalog(
      input.database,
    ).listAuthoritativeArtifacts();

  if (
    catalog.length !== expectedItems.length ||
    catalog.length > maximumArtifactCount
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  const expectedFiles = new Set<string>([
    'profile.sqlite',
    artifactCatalogLogicalPath,
  ]);
  let artifactTotalByteSize = 0;

  for (let index = 0; index < expectedItems.length; index += 1) {
    const expected = expectedItems[index];
    const actual = catalog[index];

    if (
      expected === undefined ||
      actual === undefined ||
      !catalogEntryMatches(actual, expected)
    ) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
    }

    expectedFiles.add(actual.logicalPath);
    const artifactPath = resolve(
      input.operationRoot,
      ...actual.logicalPath.split('/'),
    );
    assertContainedPath(input.operationRoot, artifactPath);
    const inspected = await inspectPdfArtifact(artifactPath);

    if (
      inspected.byteSize !== actual.byteSize ||
      inspected.sha256 !== actual.sha256
    ) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
    }

    artifactTotalByteSize += inspected.byteSize;
    if (
      !Number.isSafeInteger(artifactTotalByteSize) ||
      artifactTotalByteSize > maximumProfileArtifactBytes
    ) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
    }
  }

  await assertFilesystemClosure(input.operationRoot, expectedFiles);
  return {
    artifactCount: catalog.length,
    artifactTotalByteSize,
  };
}

function parseArtifactCatalog(content: Buffer): StagedArtifactCatalogEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(
      content,
    ));
  } catch {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, ['artifacts', 'formatVersion']) ||
    parsed.formatVersion !== 1 ||
    !Array.isArray(parsed.artifacts) ||
    parsed.artifacts.length > maximumArtifactCount
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  return parsed.artifacts.map(parseCatalogEntry);
}

function parseCatalogEntry(value: unknown): StagedArtifactCatalogEntry {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'byteSize',
      'fileName',
      'logicalPath',
      'mediaType',
      'owner',
      'restoreValidationIdentity',
      'sha256',
      'sourceIdentity',
    ]) ||
    !Number.isSafeInteger(value.byteSize) ||
    (value.byteSize as number) < pdfSignature.byteLength ||
    (value.byteSize as number) > maximumInvoicePdfBytes ||
    !isBoundedText(value.fileName) ||
    !isSafeLogicalPath(value.logicalPath) ||
    value.mediaType !== 'application/pdf' ||
    value.owner !== artifactOwner ||
    typeof value.sha256 !== 'string' ||
    !sha256Pattern.test(value.sha256) ||
    !isRestoreIdentity(value.restoreValidationIdentity) ||
    !isSourceIdentity(value.sourceIdentity)
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  return value as unknown as StagedArtifactCatalogEntry;
}

function catalogEntryMatches(
  actual: StagedArtifactCatalogEntry,
  expected: InvoiceBackupArtifactCatalogItem,
): boolean {
  const logicalPath = createArtifactLogicalPath(expected.documentId);
  return (
    actual.byteSize === expected.sizeBytes &&
    actual.fileName === expected.fileName &&
    actual.logicalPath === logicalPath &&
    actual.mediaType === expected.mediaType &&
    actual.sha256 === expected.sha256 &&
    actual.restoreValidationIdentity.companyId === expected.companyId &&
    actual.restoreValidationIdentity.documentId === expected.documentId &&
    actual.restoreValidationIdentity.documentType ===
      expected.documentType &&
    actual.restoreValidationIdentity.invoiceId === expected.invoiceId &&
    actual.restoreValidationIdentity.storagePath === expected.storagePath &&
    actual.sourceIdentity.companyId === expected.companyId &&
    actual.sourceIdentity.documentId === expected.documentId &&
    actual.sourceIdentity.invoiceId === expected.invoiceId &&
    actual.sourceIdentity.storagePath === expected.storagePath
  );
}

function createArtifactLogicalPath(documentId: string): string {
  return `artifacts/invoicing/invoice-documents/${createHash('sha256')
    .update(documentId, 'utf8')
    .digest('hex')}.pdf`;
}

async function inspectPdfArtifact(path: string): Promise<{
  byteSize: number;
  sha256: string;
}> {
  const metadata = await fileSystem.lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < pdfSignature.byteLength ||
    metadata.size > maximumInvoicePdfBytes
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  const realPath = await fileSystem.realpath(path);
  if (!pathsAreEqual(realPath, path)) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  const hash = createHash('sha256');
  let byteSize = 0;
  let signature = Buffer.alloc(0);

  for await (const chunk of createReadStream(path)) {
    const content = chunk as Buffer;
    if (byteSize === 0) {
      signature = Buffer.from(
        content.subarray(0, pdfSignature.byteLength),
      );
    }
    byteSize += content.byteLength;
    if (byteSize > maximumInvoicePdfBytes) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
    }
    hash.update(content);
  }

  if (!signature.equals(pdfSignature)) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }

  return { byteSize, sha256: hash.digest('hex') };
}

async function assertFilesystemClosure(
  operationRoot: string,
  expectedFiles: ReadonlySet<string>,
): Promise<void> {
  const expectedDirectories = new Set<string>();
  for (const logicalPath of expectedFiles) {
    const segments = logicalPath.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join('/'));
    }
  }

  const visit = async (directoryPath: string): Promise<void> => {
    const entries = await fileSystem.readdir(directoryPath, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const path = join(directoryPath, entry.name);
      const logicalPath = relative(operationRoot, path).split(sep).join('/');
      const metadata = await fileSystem.lstat(path);

      if (metadata.isSymbolicLink()) {
        throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
      }
      if (metadata.isDirectory()) {
        if (!expectedDirectories.has(logicalPath)) {
          throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
        }
        await visit(path);
      } else if (
        !metadata.isFile() ||
        metadata.nlink !== 1 ||
        !expectedFiles.has(logicalPath)
      ) {
        throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
      }
    }
  };

  await visit(operationRoot);
}

function isRestoreIdentity(value: unknown): value is {
  companyId: string;
  documentId: string;
  documentType: 'approved_invoice_pdf';
  invoiceId: string;
  storagePath: string;
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'companyId',
      'documentId',
      'documentType',
      'invoiceId',
      'storagePath',
    ]) &&
    isBoundedText(value.companyId) &&
    isBoundedText(value.documentId) &&
    value.documentType === 'approved_invoice_pdf' &&
    isBoundedText(value.invoiceId) &&
    isBoundedText(value.storagePath)
  );
}

function isSourceIdentity(value: unknown): value is {
  companyId: string;
  documentId: string;
  invoiceId: string;
  storagePath: string;
} {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      'companyId',
      'documentId',
      'invoiceId',
      'storagePath',
    ]) &&
    isBoundedText(value.companyId) &&
    isBoundedText(value.documentId) &&
    isBoundedText(value.invoiceId) &&
    isBoundedText(value.storagePath)
  );
}

function isBoundedText(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value !== '' &&
    Buffer.byteLength(value, 'utf8') <= maximumTextBytes &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}

function isSafeLogicalPath(value: unknown): value is string {
  if (!isBoundedText(value) || value.includes('\\')) {
    return false;
  }
  const segments = value.split('/');
  return (
    !value.startsWith('/') &&
    !/^[a-zA-Z]:/u.test(value) &&
    segments.every(
      (segment) =>
        segment !== '' && segment !== '.' && segment !== '..',
    )
  );
}

function assertContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolutePath(relativePath)
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID');
  }
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/u.test(path);
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);
  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}
