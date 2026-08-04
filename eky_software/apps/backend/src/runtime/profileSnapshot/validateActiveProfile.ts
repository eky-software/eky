import { createHash } from 'node:crypto';
import { createReadStream, promises as fileSystem } from 'node:fs';
import { isAbsolute, posix, resolve } from 'node:path';

import type { DatabaseConnection } from '../../database/connection/createDatabaseConnection.js';
import { SqliteInvoiceBackupArtifactCatalog } from '../../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import type { InvoiceBackupArtifactCatalogItem } from '../../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';
import type {
  ActiveProfileValidationMetadata,
  ActiveProfileValidationService,
} from './profileSnapshotTypes.js';

const maximumArtifactCount = 100_000;
const maximumInvoicePdfBytes = 10 * 1024 * 1024;
const maximumProfileArtifactBytes = 20 * 1024 * 1024 * 1024;
const maximumStoragePathBytes = 1_024;
const pdfSignature = Buffer.from('%PDF-', 'ascii');

export class CurrentActiveProfileValidationService
  implements ActiveProfileValidationService
{
  private readonly storageRoot: string;

  constructor(
    private readonly database: DatabaseConnection,
    invoiceDocumentStorageRoot: string,
  ) {
    if (!isAbsolute(invoiceDocumentStorageRoot)) {
      throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
    }
    this.storageRoot = resolve(invoiceDocumentStorageRoot);
  }

  async validateActiveProfile(): Promise<ActiveProfileValidationMetadata> {
    try {
      const integrityResult: unknown = this.database.pragma(
        'integrity_check',
        { simple: true },
      );
      const foreignKeyRows = this.database.pragma(
        'foreign_key_check',
      ) as unknown[];
      if (integrityResult !== 'ok' || foreignKeyRows.length !== 0) {
        throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
      }

      const artifacts =
        await new SqliteInvoiceBackupArtifactCatalog(
          this.database,
        ).listAuthoritativeArtifacts();
      if (artifacts.length > maximumArtifactCount) {
        throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
      }

      let artifactTotalByteSize = 0;
      for (const artifact of artifacts) {
        const inspected = await inspectActivePdf(
          this.storageRoot,
          artifact,
        );
        artifactTotalByteSize += inspected.byteSize;
        if (
          !Number.isSafeInteger(artifactTotalByteSize) ||
          artifactTotalByteSize > maximumProfileArtifactBytes
        ) {
          throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
        }
      }

      return {
        artifactCount: artifacts.length,
        artifactTotalByteSize,
        databaseHealth: 'healthy',
      };
    } catch {
      throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
    }
  }
}

async function inspectActivePdf(
  storageRoot: string,
  artifact: InvoiceBackupArtifactCatalogItem,
): Promise<{ byteSize: number }> {
  validateStoragePath(artifact.storagePath);
  const artifactPath = resolve(
    storageRoot,
    ...artifact.storagePath.split('/'),
  );
  assertContainedPath(storageRoot, artifactPath);

  const [realStorageRoot, realArtifactPath] = await Promise.all([
    fileSystem.realpath(storageRoot),
    fileSystem.realpath(artifactPath),
  ]);
  assertContainedPath(realStorageRoot, realArtifactPath);
  if (!pathsAreEqual(artifactPath, realArtifactPath)) {
    throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
  }

  const metadata = await fileSystem.lstat(artifactPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < pdfSignature.byteLength ||
    metadata.size > maximumInvoicePdfBytes ||
    metadata.size !== artifact.sizeBytes
  ) {
    throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
  }

  const hash = createHash('sha256');
  let byteSize = 0;
  let signature = Buffer.alloc(0);
  for await (const chunk of createReadStream(artifactPath)) {
    const content = chunk as Buffer;
    if (byteSize === 0) {
      signature = Buffer.from(
        content.subarray(0, pdfSignature.byteLength),
      );
    }
    byteSize += content.byteLength;
    if (byteSize > maximumInvoicePdfBytes) {
      throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
    }
    hash.update(content);
  }

  if (
    !signature.equals(pdfSignature) ||
    hash.digest('hex') !== artifact.sha256
  ) {
    throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
  }
  return { byteSize };
}

function validateStoragePath(storagePath: string): void {
  const segments = storagePath.split('/');
  if (
    storagePath === '' ||
    Buffer.byteLength(storagePath, 'utf8') > maximumStoragePathBytes ||
    isAbsolute(storagePath) ||
    posix.isAbsolute(storagePath) ||
    storagePath.includes('\\') ||
    storagePath.includes('\0') ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        /[\u0000-\u001f\u007f]/u.test(segment),
    )
  ) {
    throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
  }
}

function assertContainedPath(root: string, candidate: string): void {
  const normalizedRoot = normalizeForComparison(resolve(root));
  const normalizedCandidate = normalizeForComparison(resolve(candidate));
  if (
    normalizedCandidate === normalizedRoot ||
    !normalizedCandidate.startsWith(`${normalizedRoot}/`)
  ) {
    throw new Error('ACTIVE_PROFILE_VALIDATION_FAILED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  return (
    normalizeForComparison(resolve(first)) ===
    normalizeForComparison(resolve(second))
  );
}

function normalizeForComparison(path: string): string {
  const normalized = path.replaceAll('\\', '/');
  return process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}
