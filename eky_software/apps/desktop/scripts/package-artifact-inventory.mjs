import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const smokeAllowlist = new Set([
  'dist/main/applicationProtocolSmoke.js',
  'dist/main/packagedSmoke.js',
  'dist/main/packagedSupportBundleSmoke.js',
  'dist/pdf/invoicePdfPreviewSmoke.js',
  'dist/profileBackup/packagedProfileBackupSmoke.js',
]);
const updateRuntimeAllowlist = new Set([
  'inspectWindowsInstallerIdentity.ps1',
  'inspectWindowsRegularFile.ps1',
  'rollbackWindowsInstaller.ps1',
]);
const validStages = new Set([
  'applicationStage',
  'backendStage',
  'desktopRuntimeStage',
  'updateRuntimeStage',
  'packagedApp',
]);
const reviewedVendorSensitiveArtifactAllowlist = new Set([]);
const maximumCredentialJsonInspectionBytes = 1_048_576;
const stageLimits = Object.freeze({
  applicationStage: Object.freeze({
    maximumDirectoryDepth: 5,
    maximumFileCount: 320,
    maximumLogicalPathBytes: 96,
    maximumProjectOwnedFileBytes: 1_048_576,
    maximumTotalBytes: 2_097_152,
  }),
  backendStage: Object.freeze({
    maximumDirectoryDepth: 9,
    maximumFileCount: 2_700,
    maximumLogicalPathBytes: 128,
    maximumProjectOwnedFileBytes: 262_144,
    maximumTotalBytes: 67_108_864,
  }),
  desktopRuntimeStage: Object.freeze({
    maximumDirectoryDepth: 3,
    maximumFileCount: 64,
    maximumLogicalPathBytes: 96,
    maximumProjectOwnedFileBytes: 262_144,
    maximumTotalBytes: 1_048_576,
  }),
  updateRuntimeStage: Object.freeze({
    maximumDirectoryDepth: 1,
    maximumFileCount: 3,
    maximumLogicalPathBytes: 64,
    maximumProjectOwnedFileBytes: 32_768,
    maximumTotalBytes: 64_000,
  }),
  packagedApp: Object.freeze({
    maximumDirectoryDepth: 11,
    maximumFileCount: 2_800,
    maximumLogicalPathBytes: 160,
    maximumProjectOwnedFileBytes: 2_097_152,
    maximumTotalBytes: 536_870_912,
  }),
});

export class PackageArtifactInventoryError extends Error {
  constructor(reason) {
    super(`PACKAGE_ARTIFACT_INVENTORY_INVALID:${reason}`);
    this.name = 'PackageArtifactInventoryError';
  }
}

export async function inspectPackageArtifactInventory({ root, stage }) {
  if (!validStages.has(stage)) {
    throw new PackageArtifactInventoryError('STAGE');
  }
  const files = await listRegularFiles(root);
  const limits = stageLimits[stage];
  if (files.length > limits.maximumFileCount) {
    throw new PackageArtifactInventoryError('FILE_COUNT');
  }
  const hash = createHash('sha256').update('Eky package inventory v1\0');
  let totalByteSize = 0;

  for (const file of files) {
    const logicalPath = relative(root, file).split(sep).join('/');
    const pathBytes = Buffer.from(logicalPath, 'utf8');
    if (pathBytes.byteLength > limits.maximumLogicalPathBytes) {
      throw new PackageArtifactInventoryError('LOGICAL_PATH');
    }
    if (logicalPath.split('/').length - 1 > limits.maximumDirectoryDepth) {
      throw new PackageArtifactInventoryError('DIRECTORY_DEPTH');
    }
    const metadata = await lstat(file);
    const contentReason = await classifyForbiddenArtifactContents({
      file,
      logicalPath,
      size: metadata.size,
      stage,
    });
    if (contentReason !== undefined) {
      throw new PackageArtifactInventoryError(contentReason);
    }
    const reason = classifyForbiddenArtifact(logicalPath, stage);
    if (reason !== undefined) {
      throw new PackageArtifactInventoryError(reason);
    }
    if (
      isProjectOwnedArtifact(logicalPath, stage) &&
      metadata.size > limits.maximumProjectOwnedFileBytes
    ) {
      throw new PackageArtifactInventoryError('PROJECT_FILE_SIZE');
    }
    totalByteSize += metadata.size;
    if (
      !Number.isSafeInteger(totalByteSize) ||
      totalByteSize > limits.maximumTotalBytes
    ) {
      throw new PackageArtifactInventoryError('SIZE');
    }
    const fileHash = await hashFile(file);
    const lengths = Buffer.alloc(12);
    lengths.writeUInt32BE(pathBytes.byteLength, 0);
    lengths.writeBigUInt64BE(BigInt(metadata.size), 4);
    hash.update(lengths).update(pathBytes).update(fileHash, 'hex');
  }

  return Object.freeze({
    fileCount: files.length,
    identity: hash.digest('hex'),
    stage,
    totalByteSize,
  });
}

export function classifyForbiddenArtifact(logicalPath, stage) {
  const normalized = logicalPath.replaceAll('\\', '/');
  const lowerPath = normalized.toLowerCase();
  const segments = lowerPath.split('/');
  const fileName = segments.at(-1) ?? '';
  const isProjectOwned = isProjectOwnedArtifact(normalized, stage);

  if (stage === 'updateRuntimeStage' && !updateRuntimeAllowlist.has(normalized)) {
    return 'UNAPPROVED_UPDATE_RUNTIME_ARTIFACT';
  }

  if (/\.(?:key|p12|pfx)$/.test(fileName)) {
    return 'PRIVATE_KEY_ARTIFACT';
  }
  if (isServiceAccountJsonFileName(fileName)) {
    return 'SERVICE_ACCOUNT_ARTIFACT';
  }
  if (/\.(?:sqlite|sqlite3|db)(?:-(?:wal|shm))?$/.test(fileName)) {
    return 'DATABASE';
  }
  if (/\.(?:pdf|ekybackup|ekysupport|jsonl)$/.test(fileName)) {
    return 'BUSINESS_OR_DIAGNOSTIC_ARTIFACT';
  }
  if (fileName === '.env' || fileName.startsWith('.env.')) {
    return 'ENVIRONMENT_FILE';
  }
  if (
    fileName === 'company-email-smtp-v1.dat' ||
    /\.(?:secret|blob)$/.test(fileName)
  ) {
    return 'SECRET_BLOB';
  }
  if (
    segments.includes('support-bundles') ||
    segments.includes('playwright-report') ||
    segments.includes('test-results') ||
    segments.includes('.runtime') ||
    segments.includes('e2e-dist')
  ) {
    return 'GENERATED_TEST_OR_SUPPORT_ARTIFACT';
  }
  if (
    isProjectOwned &&
    (segments.includes('fixtures') ||
      segments.includes('testfixtures') ||
      fileName.endsWith('testsupport.js') ||
      segments.includes('src') ||
      segments.includes('tests') ||
      /\.(?:test|spec)\.[^.]+$/.test(fileName))
  ) {
    return 'SOURCE_OR_TEST_ARTIFACT';
  }
  if (isProjectOwned && fileName.endsWith('.map')) {
    return 'PROJECT_SOURCE_MAP';
  }
  if (
    isProjectOwned &&
    /(?:\.json\.gz|\.(?:log|bak|backup|dmp|pem))$/.test(fileName)
  ) {
    return 'PROJECT_RUNTIME_OR_SENSITIVE_ARTIFACT';
  }
  if (
    !isProjectOwned &&
    /(?:\.json\.gz|\.(?:log|bak|backup|dmp|pem))$/.test(fileName) &&
    !reviewedVendorSensitiveArtifactAllowlist.has(lowerPath)
  ) {
    return 'VENDOR_SENSITIVE_ARTIFACT_REVIEW_REQUIRED';
  }
  if (isProjectOwned && /smoke/i.test(normalized)) {
    if (stage !== 'applicationStage' || !smokeAllowlist.has(normalized)) {
      return 'UNAPPROVED_SMOKE_HELPER';
    }
  }
  return undefined;
}

async function classifyForbiddenArtifactContents({
  file,
  logicalPath,
  size,
  stage,
}) {
  const lowerPath = logicalPath.replaceAll('\\', '/').toLowerCase();

  if (lowerPath.endsWith('.pem')) {
    const content = await readFile(file, 'utf8');
    if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(content)) {
      return 'PRIVATE_KEY_ARTIFACT';
    }
  }

  if (!lowerPath.endsWith('.json')) {
    return undefined;
  }
  if (size > maximumCredentialJsonInspectionBytes) {
    return isProjectOwnedArtifact(logicalPath, stage)
      ? undefined
      : 'VENDOR_CREDENTIAL_JSON_REVIEW_REQUIRED';
  }

  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (isServiceAccountJson(value)) {
      return 'SERVICE_ACCOUNT_ARTIFACT';
    }
  } catch {
    // Non-JSON content with a .json suffix is handled by its owning runtime.
  }
  return undefined;
}

function isServiceAccountJsonFileName(fileName) {
  return (
    fileName.endsWith('.json') &&
    /(?:^|[-_.])service[-_.]?account(?:[-_.]|$)/.test(fileName)
  );
}

function isServiceAccountJson(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    value.type === 'service_account' &&
    typeof value.client_email === 'string' &&
    typeof value.private_key === 'string'
  );
}

function isProjectOwnedArtifact(logicalPath, stage) {
  const normalized = logicalPath.replaceAll('\\', '/').toLowerCase();
  const segments = normalized.split('/');
  const nearestNodeModulesIndex = segments.lastIndexOf('node_modules');
  if (nearestNodeModulesIndex !== -1) {
    return segments[nearestNodeModulesIndex + 1] === '@eky';
  }
  if (stage !== 'packagedApp') {
    return true;
  }
  return (
    normalized === 'resources/app.asar' ||
    normalized.startsWith('resources/backend/') ||
    normalized.startsWith('resources/desktop-runtime/') ||
    normalized.startsWith('resources/update-runtime/')
  );
}

async function listRegularFiles(root) {
  const result = [];
  const visit = async (directory) => {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        throw new PackageArtifactInventoryError('SYMLINK');
      }
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile()) {
        result.push(path);
      } else {
        throw new PackageArtifactInventoryError('FILE_TYPE');
      }
    }
  };
  await visit(root);
  return result.sort((left, right) => {
    const leftPath = relative(root, left).split(sep).join('/');
    const rightPath = relative(root, right).split(sep).join('/');
    return leftPath < rightPath ? -1 : leftPath > rightPath ? 1 : 0;
  });
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}
