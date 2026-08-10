import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const smokeAllowlist = new Set([
  'dist/main/applicationProtocolSmoke.js',
  'dist/main/packagedSmoke.js',
  'dist/main/packagedSupportBundleSmoke.js',
  'dist/pdf/invoicePdfPreviewSmoke.js',
  'dist/profileBackup/packagedProfileBackupSmoke.js',
]);
const validStages = new Set([
  'applicationStage',
  'backendStage',
  'desktopRuntimeStage',
  'packagedApp',
]);

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
  const hash = createHash('sha256').update('Eky package inventory v1\0');
  let totalByteSize = 0;

  for (const file of files) {
    const logicalPath = relative(root, file).split(sep).join('/');
    const reason = classifyForbiddenArtifact(logicalPath, stage);
    if (reason !== undefined) {
      throw new PackageArtifactInventoryError(reason);
    }
    const metadata = await lstat(file);
    totalByteSize += metadata.size;
    if (!Number.isSafeInteger(totalByteSize)) {
      throw new PackageArtifactInventoryError('SIZE');
    }
    const fileHash = await hashFile(file);
    const pathBytes = Buffer.from(logicalPath, 'utf8');
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
  const nearestNodeModulesIndex = segments.lastIndexOf('node_modules');
  const isProjectOwned =
    nearestNodeModulesIndex === -1 ||
    segments[nearestNodeModulesIndex + 1] === '@eky';

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
      segments.includes('src') ||
      segments.includes('tests') ||
      /\.(?:test|spec)\.[^.]+$/.test(fileName))
  ) {
    return 'SOURCE_OR_TEST_ARTIFACT';
  }
  if (isProjectOwned && /smoke/i.test(normalized)) {
    if (stage !== 'applicationStage' || !smokeAllowlist.has(normalized)) {
      return 'UNAPPROVED_SMOKE_HELPER';
    }
  }
  return undefined;
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
  return result.sort((left, right) =>
    relative(root, left).localeCompare(relative(root, right), 'en'),
  );
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}
