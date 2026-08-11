import {
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  statfs,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import type { DesktopReleaseInfo } from '../release/desktopReleaseInfo.js';
import {
  parseLocalUpdateCacheMetadata,
  type LocalUpdateCacheMetadata,
} from './localUpdateCacheMetadata.js';
import {
  assertLocalUpdateSourceUnchanged,
  copyLocalUpdatePackageWithHash,
  hashLocalUpdateFile,
  readLocalUpdateSourceSnapshot,
  writeExclusiveSyncedFile,
  type LocalUpdateFileIdentity,
} from './localUpdateFileOperations.js';
import {
  parseUpdatePackageManifestBytes,
  UPDATE_PACKAGE_MANIFEST_MAX_BYTES,
  UPDATE_PACKAGE_MAX_BYTES,
  type LocalUnsignedPilotUpdatePackageManifest,
} from './updatePackageManifest.js';
import type {
  LocalUpdateCacheSlotRole,
  LocalUpdatePackageRole,
  UpdatePackageTrustPolicy,
} from './updatePackageTrustPolicy.js';
import { verifyLocalUnsignedPilotSharedIdentity } from './localUnsignedPilotUpdatePackageTrustPolicy.js';
import type { WindowsInstallerIdentity } from './windowsInstallerIdentity.js';
import type { WindowsRegularFileMetadata } from './windowsRegularFileMetadata.js';

const manifestCacheFilename = 'package.manifest.json';
const metadataCacheFilename = 'slot-metadata.json';
const metadataNextFilename = 'slot-metadata.next';
const metadataBackupFilename = 'slot-metadata.backup';
const metadataMaxBytes = 16 * 1024;
const freeSpaceReserveBytes = 8 * 1024 * 1024;
export const LOCAL_UPDATE_CACHE_TOTAL_MAX_BYTES =
  3 * UPDATE_PACKAGE_MAX_BYTES + 4 * UPDATE_PACKAGE_MANIFEST_MAX_BYTES;

export interface LocalUpdatePackageSummary {
  appVersion: string;
  buildRevision: string;
  msiProductVersion: string;
  releaseChannel: 'pilot';
  role: LocalUpdatePackageRole;
  signingStatus: 'unsigned-prototype';
}

export interface LocalUpdateExpectedPackageIdentity {
  appVersion: string;
  buildRevision: string;
  msiProductVersion: string;
  packageSha256: string;
  packageSize: number;
}

export interface RevalidatedLocalUpdatePackageHandle {
  appVersion: string;
  buildRevision: string;
  msiProductVersion: string;
  packagePath: string;
}

interface LocalUpdatePackageCacheOptions {
  cacheRoot: string;
  inspectInstaller(
    path: string,
  ): Promise<Readonly<WindowsInstallerIdentity>>;
  inspectRegularFile(
    path: string,
  ): Promise<Readonly<WindowsRegularFileMetadata>>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  trustPolicy: UpdatePackageTrustPolicy;
  copyPackage?: typeof copyLocalUpdatePackageWithHash;
  getAvailableBytes?: (path: string) => Promise<bigint>;
  now?: () => Date;
}

export class LocalUpdatePackageCacheError extends Error {
  constructor() {
    super('The local update package could not be stored safely.');
    this.name = 'LocalUpdatePackageCacheError';
  }
}

export class LocalUpdatePackageCache {
  private activeOperation = false;

  constructor(private readonly options: LocalUpdatePackageCacheOptions) {
    if (!isAbsolute(options.cacheRoot) || resolve(options.cacheRoot) !== options.cacheRoot) {
      throw new LocalUpdatePackageCacheError();
    }
  }

  async getCurrentRegistrationState(): Promise<'missing' | 'ready'> {
    return this.runExclusive(async () => {
      await this.ensureCacheRoot();
      const currentPath = this.slotPath('current');
      if (!(await pathExists(currentPath))) {
        return 'missing';
      }
      await this.validateSlot('current', currentPath);
      return 'ready';
    });
  }

  async stageSelectedPackage(input: {
    manifestPath: string;
    role: LocalUpdatePackageRole;
  }): Promise<Readonly<LocalUpdatePackageSummary>> {
    return this.runExclusive(async () => {
      const source = await this.readAndVerifySource(input);
      await this.ensureCacheRoot();
      const slotPath = this.slotPath(input.role);
      if (await pathExists(slotPath)) {
        const cached = await this.validateSlot(input.role, slotPath);
        if (metadataMatchesManifest(cached, source.manifest)) {
          return createSafeSummary(source.manifest, input.role);
        }
        throw new LocalUpdatePackageCacheError();
      }

      await this.assertCapacity(source.manifest.packageSize);
      const stagingPath = await mkdtemp(join(this.options.cacheRoot, '.staging-'));
      try {
        const stagedManifestPath = join(stagingPath, manifestCacheFilename);
        const stagedPackagePath = join(
          stagingPath,
          source.manifest.packageFilename,
        );
        await writeExclusiveSyncedFile(stagedManifestPath, source.manifestBytes);
        const copied = await (this.options.copyPackage ??
          copyLocalUpdatePackageWithHash)(source.packagePath, stagedPackagePath);
        const packageAfter = await readLocalUpdateSourceSnapshot(
          source.packagePath,
          this.options.inspectRegularFile,
        );
        assertLocalUpdateSourceUnchanged(source.packageBefore, packageAfter);
        assertPackageIdentity(source.manifest, copied);

        await this.validateStagedFiles(
          input.role,
          stagedManifestPath,
          stagedPackagePath,
        );
        await this.writeMetadata(stagingPath, source.manifest, input.role);
        await rename(stagingPath, slotPath);
        await this.validateSlot(input.role, slotPath);
        return createSafeSummary(source.manifest, input.role);
      } catch {
        await rm(stagingPath, { force: true, recursive: true }).catch(
          () => undefined,
        );
        throw new LocalUpdatePackageCacheError();
      }
    });
  }

  async revalidateJournalPackage(input: {
    expectedIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
    role: LocalUpdateCacheSlotRole;
  }): Promise<Readonly<RevalidatedLocalUpdatePackageHandle>> {
    return this.runExclusive(async () => {
      await this.ensureCacheRoot();
      return this.validateJournalSlot(
        input.role,
        this.slotPath(input.role),
        input.expectedIdentity,
        new Set([input.role]),
      );
    });
  }

  async promoteAcceptedCandidate(input: {
    candidateIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
    currentIdentity: Readonly<LocalUpdateExpectedPackageIdentity>;
  }): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureCacheRoot();
      const currentPath = this.slotPath('current');
      const candidatePath = this.slotPath('candidate');
      const previousPath = this.slotPath('previous');
      const currentExists = await pathExists(currentPath);
      const candidateExists = await pathExists(candidatePath);
      const previousExists = await pathExists(previousPath);

      if (currentExists && candidateExists) {
        await this.validateJournalSlot(
          'current',
          currentPath,
          input.currentIdentity,
          new Set(['current']),
        );
        await this.validateJournalSlot(
          'candidate',
          candidatePath,
          input.candidateIdentity,
          new Set(['candidate']),
        );
        if (previousExists) {
          await assertSlotDirectory(previousPath);
          await rm(previousPath, { recursive: true });
          await syncDirectory(this.options.cacheRoot);
        }
        await rename(currentPath, previousPath);
        await syncDirectory(this.options.cacheRoot);
      } else if (
        currentExists ||
        !candidateExists ||
        !previousExists
      ) {
        if (!(currentExists && previousExists && !candidateExists)) {
          throw new LocalUpdatePackageCacheError();
        }
      }

      if (await pathExists(candidatePath)) {
        await this.validateJournalSlot(
          'previous',
          previousPath,
          input.currentIdentity,
          new Set(['current', 'previous']),
        );
        await this.validateJournalSlot(
          'candidate',
          candidatePath,
          input.candidateIdentity,
          new Set(['candidate']),
        );
        await rename(candidatePath, currentPath);
        await syncDirectory(this.options.cacheRoot);
      }

      const current = await this.validateJournalSlot(
        'current',
        currentPath,
        input.candidateIdentity,
        new Set(['candidate', 'current']),
      );
      const previous = await this.validateJournalSlot(
        'previous',
        previousPath,
        input.currentIdentity,
        new Set(['current', 'previous']),
      );
      await this.writeMetadata(currentPath, current.manifest, 'current');
      await this.writeMetadata(previousPath, previous.manifest, 'previous');
      await syncDirectory(this.options.cacheRoot);
      await this.validateJournalSlot(
        'current',
        currentPath,
        input.candidateIdentity,
        new Set(['current']),
      );
      await this.validateJournalSlot(
        'previous',
        previousPath,
        input.currentIdentity,
        new Set(['previous']),
      );
    });
  }

  private async readAndVerifySource(input: {
    manifestPath: string;
    role: LocalUpdatePackageRole;
  }): Promise<{
    manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>;
    manifestBytes: Uint8Array;
    packageBefore: Awaited<ReturnType<typeof readLocalUpdateSourceSnapshot>>;
    packagePath: string;
  }> {
    try {
      if (!isAbsolute(input.manifestPath)) {
        throw new LocalUpdatePackageCacheError();
      }
      const manifestBefore = await readLocalUpdateSourceSnapshot(
        input.manifestPath,
        this.options.inspectRegularFile,
      );
      if (manifestBefore.size > UPDATE_PACKAGE_MANIFEST_MAX_BYTES) {
        throw new LocalUpdatePackageCacheError();
      }
      const manifestBytes = await readFile(input.manifestPath);
      const manifestAfter = await readLocalUpdateSourceSnapshot(
        input.manifestPath,
        this.options.inspectRegularFile,
      );
      assertLocalUpdateSourceUnchanged(manifestBefore, manifestAfter);
      const manifest = parseUpdatePackageManifestBytes(manifestBytes);
      const packagePath = join(dirname(input.manifestPath), manifest.packageFilename);
      const packageBefore = await readLocalUpdateSourceSnapshot(
        packagePath,
        this.options.inspectRegularFile,
      );
      if (packageBefore.size !== manifest.packageSize) {
        throw new LocalUpdatePackageCacheError();
      }
      const installerIdentity = await this.options.inspectInstaller(packagePath);
      this.options.trustPolicy.verifyPackage({
        installerIdentity,
        manifest,
        releaseInfo: this.options.releaseInfo,
        role: input.role,
      });
      const sourceIdentity = await hashLocalUpdateFile(packagePath);
      assertPackageIdentity(manifest, sourceIdentity);
      const packageAfterVerification = await readLocalUpdateSourceSnapshot(
        packagePath,
        this.options.inspectRegularFile,
      );
      assertLocalUpdateSourceUnchanged(packageBefore, packageAfterVerification);
      return { manifest, manifestBytes, packageBefore, packagePath };
    } catch {
      throw new LocalUpdatePackageCacheError();
    }
  }

  private async validateSlot(
    role: LocalUpdatePackageRole,
    slotPath: string,
  ): Promise<Readonly<LocalUpdateCacheMetadata>> {
    const directory = await lstat(slotPath);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new LocalUpdatePackageCacheError();
    }
    const metadata = await readSlotMetadata(slotPath);
    if (metadata.role !== role) {
      throw new LocalUpdatePackageCacheError();
    }
    const manifestPath = join(slotPath, manifestCacheFilename);
    const manifestBytes = await readBoundedFile(
      manifestPath,
      UPDATE_PACKAGE_MANIFEST_MAX_BYTES,
    );
    const manifest = parseUpdatePackageManifestBytes(manifestBytes);
    assertMetadataMatchesManifest(metadata, manifest);
    await this.validateStagedFiles(
      role,
      manifestPath,
      join(slotPath, manifest.packageFilename),
    );
    return metadata;
  }

  private async validateJournalSlot(
    role: LocalUpdateCacheSlotRole,
    slotPath: string,
    expectedIdentity: Readonly<LocalUpdateExpectedPackageIdentity>,
    acceptedMetadataRoles: ReadonlySet<LocalUpdateCacheSlotRole>,
  ): Promise<
    Readonly<RevalidatedLocalUpdatePackageHandle> & {
      manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>;
    }
  > {
    const directory = await lstat(slotPath);
    if (!directory.isDirectory() || directory.isSymbolicLink()) {
      throw new LocalUpdatePackageCacheError();
    }
    const metadata = await readSlotMetadata(slotPath);
    if (!acceptedMetadataRoles.has(metadata.role)) {
      throw new LocalUpdatePackageCacheError();
    }
    const manifestPath = join(slotPath, manifestCacheFilename);
    const manifest = parseUpdatePackageManifestBytes(
      await readBoundedFile(
        manifestPath,
        UPDATE_PACKAGE_MANIFEST_MAX_BYTES,
      ),
    );
    assertMetadataMatchesManifest(metadata, manifest);
    assertExpectedPackageIdentity(expectedIdentity, manifest);
    const packagePath = join(slotPath, manifest.packageFilename);
    const installerIdentity = await this.validatePackageFiles(
      manifestPath,
      packagePath,
    );
    verifyLocalUnsignedPilotSharedIdentity({
      installerIdentity,
      manifest,
      releaseInfo: this.options.releaseInfo,
    });
    return Object.freeze({
      appVersion: manifest.appVersion,
      buildRevision: manifest.buildRevision,
      manifest,
      msiProductVersion: manifest.msiProductVersion,
      packagePath,
    });
  }

  private async validateStagedFiles(
    role: LocalUpdatePackageRole,
    manifestPath: string,
    packagePath: string,
  ): Promise<void> {
    const manifest = parseUpdatePackageManifestBytes(await readFile(manifestPath));
    const installerIdentity = await this.validatePackageFiles(
      manifestPath,
      packagePath,
    );
    this.options.trustPolicy.verifyPackage({
      installerIdentity,
      manifest,
      releaseInfo: this.options.releaseInfo,
      role,
    });
  }

  private async validatePackageFiles(
    manifestPath: string,
    packagePath: string,
  ): Promise<Readonly<WindowsInstallerIdentity>> {
    const manifestBefore = await readLocalUpdateSourceSnapshot(
      manifestPath,
      this.options.inspectRegularFile,
    );
    if (manifestBefore.size > UPDATE_PACKAGE_MANIFEST_MAX_BYTES) {
      throw new LocalUpdatePackageCacheError();
    }
    const manifest = parseUpdatePackageManifestBytes(await readFile(manifestPath));
    const manifestAfter = await readLocalUpdateSourceSnapshot(
      manifestPath,
      this.options.inspectRegularFile,
    );
    assertLocalUpdateSourceUnchanged(manifestBefore, manifestAfter);
    const packageBefore = await readLocalUpdateSourceSnapshot(
      packagePath,
      this.options.inspectRegularFile,
    );
    const identity = await hashLocalUpdateFile(packagePath);
    assertPackageIdentity(manifest, identity);
    const packageAfter = await readLocalUpdateSourceSnapshot(
      packagePath,
      this.options.inspectRegularFile,
    );
    assertLocalUpdateSourceUnchanged(packageBefore, packageAfter);
    if (packageBefore.size !== identity.size) {
      throw new LocalUpdatePackageCacheError();
    }
    return this.options.inspectInstaller(packagePath);
  }

  private async writeMetadata(
    stagingPath: string,
    manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>,
    role: LocalUpdateCacheSlotRole,
  ): Promise<void> {
    const metadata = parseLocalUpdateCacheMetadata({
      appVersion: manifest.appVersion,
      buildRevision: manifest.buildRevision,
      createdAt: (this.options.now?.() ?? new Date()).toISOString(),
      msiProductVersion: manifest.msiProductVersion,
      packageFilename: manifest.packageFilename,
      packageSha256: manifest.packageSha256,
      packageSize: manifest.packageSize,
      role,
      schemaVersion: 1,
    });
    const nextPath = join(stagingPath, metadataNextFilename);
    const currentPath = join(stagingPath, metadataCacheFilename);
    const backupPath = join(stagingPath, metadataBackupFilename);
    await rm(nextPath, { force: true });
    await rm(backupPath, { force: true });
    await writeExclusiveSyncedFile(
      nextPath,
      Buffer.from(`${JSON.stringify(metadata)}\n`, 'utf8'),
    );
    let previousMoved = false;
    try {
      await rename(currentPath, backupPath);
      previousMoved = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== 'ENOENT') {
        throw error;
      }
    }
    try {
      await rename(nextPath, currentPath);
      await syncDirectory(stagingPath);
    } catch (error) {
      if (previousMoved) {
        await rename(backupPath, currentPath).catch(() => undefined);
      }
      throw error;
    }
    if (previousMoved) {
      await rm(backupPath, { force: true });
      await syncDirectory(stagingPath);
    }
  }

  private async assertCapacity(packageSize: number): Promise<void> {
    const usedBytes = await readCacheSize(this.options.cacheRoot);
    const requiredBytes =
      packageSize + UPDATE_PACKAGE_MANIFEST_MAX_BYTES + metadataMaxBytes;
    if (usedBytes + requiredBytes > LOCAL_UPDATE_CACHE_TOTAL_MAX_BYTES) {
      throw new LocalUpdatePackageCacheError();
    }
    const availableBytes = await (
      this.options.getAvailableBytes ?? getAvailableFileSystemBytes
    )(this.options.cacheRoot);
    if (availableBytes < BigInt(requiredBytes + freeSpaceReserveBytes)) {
      throw new LocalUpdatePackageCacheError();
    }
  }

  private async ensureCacheRoot(): Promise<void> {
    await mkdir(this.options.cacheRoot, { mode: 0o700, recursive: true });
    const metadata = await lstat(this.options.cacheRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new LocalUpdatePackageCacheError();
    }
  }

  private slotPath(role: LocalUpdateCacheSlotRole): string {
    return join(this.options.cacheRoot, role);
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.activeOperation) {
      throw new LocalUpdatePackageCacheError();
    }
    this.activeOperation = true;
    try {
      return await operation();
    } catch (error) {
      if (error instanceof LocalUpdatePackageCacheError) {
        throw error;
      }
      throw new LocalUpdatePackageCacheError();
    } finally {
      this.activeOperation = false;
    }
  }
}

async function readSlotMetadata(
  slotPath: string,
): Promise<Readonly<LocalUpdateCacheMetadata>> {
  const currentPath = join(slotPath, metadataCacheFilename);
  const nextPath = join(slotPath, metadataNextFilename);
  const backupPath = join(slotPath, metadataBackupFilename);
  if (await pathExists(currentPath)) {
    const metadata = await parseMetadataFile(currentPath);
    await rm(nextPath, { force: true });
    await rm(backupPath, { force: true });
    return metadata;
  }
  if (await pathExists(backupPath)) {
    const metadata = await parseMetadataFile(backupPath);
    await rename(backupPath, currentPath);
    await rm(nextPath, { force: true });
    await syncDirectory(slotPath);
    return metadata;
  }
  if (await pathExists(nextPath)) {
    const metadata = await parseMetadataFile(nextPath);
    await rename(nextPath, currentPath);
    await syncDirectory(slotPath);
    return metadata;
  }
  throw new LocalUpdatePackageCacheError();
}

async function parseMetadataFile(
  path: string,
): Promise<Readonly<LocalUpdateCacheMetadata>> {
  return parseLocalUpdateCacheMetadata(
    JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await readBoundedFile(path, metadataMaxBytes),
      ),
    ),
  );
}

async function readBoundedFile(path: string, maximumBytes: number): Promise<Buffer> {
  const metadata = await lstat(path);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new LocalUpdatePackageCacheError();
  }
  return readFile(path);
}

async function assertSlotDirectory(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new LocalUpdatePackageCacheError();
  }
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === 'win32') {
    return;
  }
  const directory = await open(path, 'r');
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function readCacheSize(root: string): Promise<number> {
  let total = 0;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const metadata = await lstat(path);
    if (metadata.isSymbolicLink()) {
      throw new LocalUpdatePackageCacheError();
    }
    if (metadata.isDirectory()) {
      total += await readCacheSize(path);
    } else if (metadata.isFile()) {
      total += metadata.size;
    } else {
      throw new LocalUpdatePackageCacheError();
    }
    if (total > LOCAL_UPDATE_CACHE_TOTAL_MAX_BYTES) {
      throw new LocalUpdatePackageCacheError();
    }
  }
  return total;
}

async function getAvailableFileSystemBytes(path: string): Promise<bigint> {
  const metadata = await statfs(path, { bigint: true });
  return metadata.bavail * metadata.bsize;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function assertPackageIdentity(
  manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>,
  identity: Readonly<LocalUpdateFileIdentity>,
): void {
  if (
    identity.size !== manifest.packageSize ||
    identity.sha256 !== manifest.packageSha256
  ) {
    throw new LocalUpdatePackageCacheError();
  }
}

function assertExpectedPackageIdentity(
  expected: Readonly<LocalUpdateExpectedPackageIdentity>,
  manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>,
): void {
  if (
    expected.appVersion !== manifest.appVersion ||
    expected.buildRevision !== manifest.buildRevision ||
    expected.msiProductVersion !== manifest.msiProductVersion ||
    expected.packageSha256 !== manifest.packageSha256 ||
    expected.packageSize !== manifest.packageSize
  ) {
    throw new LocalUpdatePackageCacheError();
  }
}

function assertMetadataMatchesManifest(
  metadata: Readonly<LocalUpdateCacheMetadata>,
  manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>,
): void {
  if (!metadataMatchesManifest(metadata, manifest)) {
    throw new LocalUpdatePackageCacheError();
  }
}

function metadataMatchesManifest(
  metadata: Readonly<LocalUpdateCacheMetadata>,
  manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>,
): boolean {
  return (
    metadata.appVersion === manifest.appVersion &&
    metadata.buildRevision === manifest.buildRevision &&
    metadata.msiProductVersion === manifest.msiProductVersion &&
    metadata.packageFilename === manifest.packageFilename &&
    metadata.packageSha256 === manifest.packageSha256 &&
    metadata.packageSize === manifest.packageSize
  );
}

function createSafeSummary(
  manifest: Readonly<LocalUnsignedPilotUpdatePackageManifest>,
  role: LocalUpdatePackageRole,
): Readonly<LocalUpdatePackageSummary> {
  return Object.freeze({
    appVersion: manifest.appVersion,
    buildRevision: manifest.buildRevision,
    msiProductVersion: manifest.msiProductVersion,
    releaseChannel: 'pilot',
    role,
    signingStatus: 'unsigned-prototype',
  });
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
