import { createHash } from 'node:crypto';
import {
  createReadStream,
  promises as fileSystem,
  type BigIntStats,
} from 'node:fs';
import type { FileHandle } from 'node:fs/promises';
import {
  isAbsolute,
  join,
  posix,
  relative,
  resolve,
  sep,
} from 'node:path';

import type {
  InvoiceBackupArtifactCatalog,
  InvoiceBackupArtifactCatalogItem,
} from '../../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';
import type { ProfileMaintenanceState } from '../profileMaintenance/profileMaintenanceState.js';
import type {
  CreateProfileSnapshotInput,
  ProfileSnapshotArtifactCatalogMetadata,
} from './profileSnapshotTypes.js';

const artifactCatalogFormatVersion = 1;
const artifactCatalogLogicalPath = 'snapshot-catalog-v1.json';
const artifactOwner = 'invoicing';
const invoiceArtifactDirectory = join(
  'artifacts',
  'invoicing',
  'invoice-documents',
);
const maximumArtifactCatalogBytes = 64 * 1024 * 1024;
const maximumArtifactCount = 100_000;
const maximumInvoicePdfBytes = 10 * 1024 * 1024;
const maximumProfileArtifactBytes = 20 * 1024 * 1024 * 1024;
const maximumStoragePathBytes = 1_024;
const maximumIdentityBytes = 512;
const pdfSignature = Buffer.from('%PDF-', 'ascii');
const sha256Pattern = /^[a-f0-9]{64}$/;

interface StageProfileBusinessArtifactsDependencies {
  catalog: InvoiceBackupArtifactCatalog;
  invoiceDocumentStorageRoot: string;
  maintenanceState: ProfileMaintenanceState;
  stagingRoot: string;
}

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

interface SourceInspection {
  identity: BigIntStats;
  sha256: string;
  sizeBytes: number;
}

export class ProfileBusinessArtifactStager {
  private readonly invoiceDocumentStorageRoot: string;
  private readonly stagingRoot: string;

  constructor(
    private readonly dependencies: StageProfileBusinessArtifactsDependencies,
  ) {
    if (
      !isAbsolute(dependencies.invoiceDocumentStorageRoot) ||
      !isAbsolute(dependencies.stagingRoot)
    ) {
      throw new Error('PROFILE_SNAPSHOT_PATH_INVALID');
    }
    this.invoiceDocumentStorageRoot = resolve(
      dependencies.invoiceDocumentStorageRoot,
    );
    this.stagingRoot = resolve(dependencies.stagingRoot);
  }

  async stageArtifacts(
    input: Pick<CreateProfileSnapshotInput, 'operationId' | 'signal'>,
  ): Promise<ProfileSnapshotArtifactCatalogMetadata> {
    if (
      !this.dependencies.maintenanceState.isActiveOperation(
        input.operationId,
      )
    ) {
      throw new Error('PROFILE_MAINTENANCE_OPERATION_MISMATCH');
    }

    const operationRoot = join(this.stagingRoot, input.operationId);
    const artifactDirectory = join(operationRoot, invoiceArtifactDirectory);
    const catalogPath = join(operationRoot, artifactCatalogLogicalPath);
    assertContainedPath(this.stagingRoot, operationRoot);
    assertContainedPath(operationRoot, artifactDirectory);
    assertContainedPath(operationRoot, catalogPath);
    await assertPrivateDirectory(operationRoot);
    await assertPathMissing(catalogPath);
    throwIfCancelled(input.signal);

    const catalog = await this.dependencies.catalog.listAuthoritativeArtifacts();

    if (catalog.length > maximumArtifactCount) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACT_LIMIT_EXCEEDED');
    }
    if (catalog.length > 0) {
      await assertKnownStorageRoot(this.invoiceDocumentStorageRoot);
    }

    if (catalog.length > 0) {
      await fileSystem.mkdir(artifactDirectory, {
        mode: 0o700,
        recursive: true,
      });
      await assertPrivateDirectory(artifactDirectory);
    }

    const logicalPaths = new Set<string>();
    const stagedArtifacts: StagedArtifactCatalogEntry[] = [];
    let artifactTotalByteSize = 0;

    for (const item of catalog) {
      throwIfCancelled(input.signal);
      const logicalPath = createArtifactLogicalPath(item);
      const caseFoldedLogicalPath = logicalPath.toLowerCase();

      if (logicalPaths.has(caseFoldedLogicalPath)) {
        throw new Error('PROFILE_SNAPSHOT_ARTIFACT_COLLISION');
      }
      logicalPaths.add(caseFoldedLogicalPath);

      const sourceFilePath = await resolveKnownSourceFile(
        this.invoiceDocumentStorageRoot,
        item.storagePath,
      );
      const inspection = await inspectSourcePdf(sourceFilePath, item);
      const destinationFilePath = join(operationRoot, ...logicalPath.split('/'));
      assertContainedPath(operationRoot, destinationFilePath);
      await copyVerifiedArtifact({
        destinationFilePath,
        expected: inspection,
        signal: input.signal,
        sourceFilePath,
      });

      artifactTotalByteSize += inspection.sizeBytes;
      if (
        !Number.isSafeInteger(artifactTotalByteSize) ||
        artifactTotalByteSize > maximumProfileArtifactBytes
      ) {
        throw new Error('PROFILE_SNAPSHOT_ARTIFACT_LIMIT_EXCEEDED');
      }

      stagedArtifacts.push(
        createStagedCatalogEntry(item, logicalPath, inspection),
      );
    }

    const catalogContent = Buffer.from(
      `${JSON.stringify({
        artifacts: stagedArtifacts,
        formatVersion: artifactCatalogFormatVersion,
      })}\n`,
      'utf8',
    );

    if (catalogContent.byteLength > maximumArtifactCatalogBytes) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACT_LIMIT_EXCEEDED');
    }

    await writeExclusiveFinalizedFile(catalogPath, catalogContent);

    return {
      artifactCount: stagedArtifacts.length,
      artifactTotalByteSize,
      catalogByteSize: catalogContent.byteLength,
      logicalPath: artifactCatalogLogicalPath,
      sha256: createHash('sha256').update(catalogContent).digest('hex'),
    };
  }
}

function createArtifactLogicalPath(
  item: InvoiceBackupArtifactCatalogItem,
): string {
  const stableIdentity = createHash('sha256')
    .update(item.documentId, 'utf8')
    .digest('hex');

  return `${invoiceArtifactDirectory.replaceAll(sep, '/')}/${stableIdentity}.pdf`;
}

function createStagedCatalogEntry(
  item: InvoiceBackupArtifactCatalogItem,
  logicalPath: string,
  inspection: SourceInspection,
): StagedArtifactCatalogEntry {
  return {
    byteSize: inspection.sizeBytes,
    fileName: item.fileName,
    logicalPath,
    mediaType: 'application/pdf',
    owner: artifactOwner,
    restoreValidationIdentity: {
      companyId: item.companyId,
      documentId: item.documentId,
      documentType: 'approved_invoice_pdf',
      invoiceId: item.invoiceId,
      storagePath: item.storagePath,
    },
    sha256: inspection.sha256,
    sourceIdentity: {
      companyId: item.companyId,
      documentId: item.documentId,
      invoiceId: item.invoiceId,
      storagePath: item.storagePath,
    },
  };
}

async function resolveKnownSourceFile(
  storageRoot: string,
  storagePath: string,
): Promise<string> {
  validateStoragePath(storagePath);
  const sourceFilePath = resolve(storageRoot, ...storagePath.split('/'));
  assertContainedPath(storageRoot, sourceFilePath);

  const [realStorageRoot, realSourceFilePath] = await Promise.all([
    fileSystem.realpath(storageRoot),
    fileSystem.realpath(sourceFilePath),
  ]);
  assertContainedPath(realStorageRoot, realSourceFilePath);

  if (!pathsAreEqual(sourceFilePath, realSourceFilePath)) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_PATH_INVALID');
  }

  return sourceFilePath;
}

function validateStoragePath(storagePath: string): void {
  const pathBytes = Buffer.byteLength(storagePath, 'utf8');
  const segments = storagePath.split('/');

  if (
    storagePath === '' ||
    pathBytes > maximumStoragePathBytes ||
    isAbsolute(storagePath) ||
    storagePath.includes('\\') ||
    storagePath.includes('\0') ||
    posix.isAbsolute(storagePath) ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        /[\u0000-\u001f\u007f]/u.test(segment),
    )
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_PATH_INVALID');
  }
}

async function inspectSourcePdf(
  sourceFilePath: string,
  item: InvoiceBackupArtifactCatalogItem,
): Promise<SourceInspection> {
  validateCatalogItem(item);
  const pathMetadata = await fileSystem.lstat(sourceFilePath, {
    bigint: true,
  });

  if (!pathMetadata.isFile() || pathMetadata.isSymbolicLink()) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_INVALID');
  }

  const file = await fileSystem.open(sourceFilePath, 'r');

  try {
    const handleMetadata = await file.stat({ bigint: true });
    assertSameFileIdentity(pathMetadata, handleMetadata);
    const inspected = await hashAndInspectPdf(file);

    if (
      inspected.sizeBytes !== item.sizeBytes ||
      inspected.sha256 !== item.sha256
    ) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACT_METADATA_MISMATCH');
    }

    return {
      identity: handleMetadata,
      sha256: inspected.sha256,
      sizeBytes: inspected.sizeBytes,
    };
  } finally {
    await file.close();
  }
}

function validateCatalogItem(item: InvoiceBackupArtifactCatalogItem): void {
  const boundedIdentityValues = [
    item.companyId,
    item.documentId,
    item.invoiceId,
    item.fileName,
  ];

  if (
    item.documentType !== 'approved_invoice_pdf' ||
    item.mediaType !== 'application/pdf' ||
    !sha256Pattern.test(item.sha256) ||
    !Number.isSafeInteger(item.sizeBytes) ||
    item.sizeBytes < pdfSignature.byteLength ||
    item.sizeBytes > maximumInvoicePdfBytes ||
    boundedIdentityValues.some(
      (value) =>
        value === '' ||
        Buffer.byteLength(value, 'utf8') > maximumIdentityBytes ||
        /[\u0000-\u001f\u007f]/u.test(value),
    )
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_INVALID');
  }
}

async function hashAndInspectPdf(
  file: FileHandle,
): Promise<{ sha256: string; sizeBytes: number }> {
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  let firstBytes = Buffer.alloc(0);
  let position = 0;

  while (true) {
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.byteLength,
      position,
    );

    if (bytesRead === 0) {
      break;
    }
    if (position === 0) {
      firstBytes = Buffer.from(
        buffer.subarray(0, Math.min(bytesRead, pdfSignature.byteLength)),
      );
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;

    if (position > maximumInvoicePdfBytes) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACT_LIMIT_EXCEEDED');
    }
  }

  if (!firstBytes.equals(pdfSignature)) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_INVALID');
  }

  return {
    sha256: hash.digest('hex'),
    sizeBytes: position,
  };
}

async function copyVerifiedArtifact(input: {
  destinationFilePath: string;
  expected: SourceInspection;
  signal: AbortSignal;
  sourceFilePath: string;
}): Promise<void> {
  await assertPathMissing(input.destinationFilePath);
  const temporaryPath = `${input.destinationFilePath}.next`;
  await assertPathMissing(temporaryPath);
  const source = await fileSystem.open(input.sourceFilePath, 'r');
  let destination: FileHandle | undefined;
  let finalCreated = false;

  try {
    const sourceMetadata = await source.stat({ bigint: true });
    assertSameFileIdentity(input.expected.identity, sourceMetadata);
    destination = await fileSystem.open(temporaryPath, 'wx', 0o600);
    const copiedHash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let position = 0;

    while (true) {
      throwIfCancelled(input.signal);
      const { bytesRead } = await source.read(
        buffer,
        0,
        buffer.byteLength,
        position,
      );

      if (bytesRead === 0) {
        break;
      }
      let written = 0;
      while (written < bytesRead) {
        const result = await destination.write(
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        written += result.bytesWritten;
      }
      copiedHash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    if (
      position !== input.expected.sizeBytes ||
      copiedHash.digest('hex') !== input.expected.sha256
    ) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACT_CHANGED');
    }

    assertSameFileIdentity(
      input.expected.identity,
      await source.stat({ bigint: true }),
    );
    await destination.sync();
    await destination.close();
    destination = undefined;

    const destinationInspection = await inspectStagedPdf(temporaryPath);
    if (
      destinationInspection.sizeBytes !== input.expected.sizeBytes ||
      destinationInspection.sha256 !== input.expected.sha256
    ) {
      throw new Error('PROFILE_SNAPSHOT_ARTIFACT_COPY_INVALID');
    }

    await fileSystem.chmod(temporaryPath, 0o400);
    await fileSystem.link(temporaryPath, input.destinationFilePath);
    finalCreated = true;
    await fileSystem.unlink(temporaryPath);
  } catch (error) {
    await destination?.close().catch(() => undefined);
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (finalCreated) {
      await fileSystem
        .rm(input.destinationFilePath, { force: true })
        .catch(() => undefined);
    }
    throw error;
  } finally {
    await source.close();
  }
}

async function inspectStagedPdf(path: string): Promise<{
  sha256: string;
  sizeBytes: number;
}> {
  const metadata = await fileSystem.lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_COPY_INVALID');
  }

  const hash = createHash('sha256');
  let sizeBytes = 0;

  for await (const chunk of createReadStream(path)) {
    const buffer = chunk as Buffer;
    hash.update(buffer);
    sizeBytes += buffer.byteLength;
  }

  return { sha256: hash.digest('hex'), sizeBytes };
}

async function writeExclusiveFinalizedFile(
  destinationPath: string,
  content: Buffer,
): Promise<void> {
  const temporaryPath = `${destinationPath}.next`;
  await assertPathMissing(temporaryPath);
  const file = await fileSystem.open(temporaryPath, 'wx', 0o600);
  let finalCreated = false;

  try {
    await file.writeFile(content);
    await file.sync();
    await file.close();
    await fileSystem.chmod(temporaryPath, 0o400);
    await fileSystem.link(temporaryPath, destinationPath);
    finalCreated = true;
    await fileSystem.unlink(temporaryPath);
  } catch (error) {
    await file.close().catch(() => undefined);
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined);
    if (finalCreated) {
      await fileSystem
        .rm(destinationPath, { force: true })
        .catch(() => undefined);
    }
    throw error;
  }
}

async function assertKnownStorageRoot(storageRoot: string): Promise<void> {
  const metadata = await fileSystem.lstat(storageRoot);

  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_PATH_INVALID');
  }

  const realStorageRoot = await fileSystem.realpath(storageRoot);
  if (!pathsAreEqual(realStorageRoot, storageRoot)) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_PATH_INVALID');
  }
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const metadata = await fileSystem.lstat(path);

  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (process.platform !== 'win32' && (metadata.mode & 0o077) !== 0)
  ) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }

  const realPath = await fileSystem.realpath(path);
  if (!pathsAreEqual(realPath, resolve(path))) {
    throw new Error('PROFILE_SNAPSHOT_STAGING_INVALID');
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await fileSystem.lstat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw error;
  }

  throw new Error('PROFILE_SNAPSHOT_DESTINATION_EXISTS');
}

function assertContainedPath(root: string, candidate: string): void {
  const relativePath = relative(root, candidate);

  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error('PROFILE_SNAPSHOT_PATH_INVALID');
  }
}

function assertSameFileIdentity(
  expected: BigIntStats,
  actual: BigIntStats,
): void {
  if (
    !actual.isFile() ||
    actual.isSymbolicLink() ||
    expected.dev !== actual.dev ||
    expected.ino !== actual.ino ||
    expected.size !== actual.size ||
    expected.mtimeNs !== actual.mtimeNs ||
    expected.ctimeNs !== actual.ctimeNs
  ) {
    throw new Error('PROFILE_SNAPSHOT_ARTIFACT_CHANGED');
  }
}

function pathsAreEqual(first: string, second: string): boolean {
  const firstResolved = resolve(first);
  const secondResolved = resolve(second);

  return process.platform === 'win32'
    ? firstResolved.toLowerCase() === secondResolved.toLowerCase()
    : firstResolved === secondResolved;
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new Error('PROFILE_SNAPSHOT_CANCELLED');
  }
}
