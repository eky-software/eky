import { randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  realpath,
  rm,
} from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import { maximumBackupCiphertextBytes } from '../../profileBackup/container/backupContainerLimits.js';
import { WorkspaceBackupImportError } from './workspaceBackupImportError.js';

const quarantineDirectoryName = 'workspace-import-plaintext-quarantine';
const quarantineFileNamePattern =
  /^workspace-import-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.payload$/;

export interface WorkspaceBackupPlaintextQuarantineRecoveryPort {
  recoverStalePayloads(): Promise<void>;
}

export interface WorkspaceBackupPlaintextQuarantinePort
  extends WorkspaceBackupPlaintextQuarantineRecoveryPort {
  createPayloadPath(): Promise<string>;
  removePayload(path: string): Promise<void>;
}

export interface WorkspaceBackupPlaintextQuarantineOptions {
  readonly userDataRoot: string;
}

export class WorkspaceBackupPlaintextQuarantine
  implements WorkspaceBackupPlaintextQuarantinePort
{
  private readonly operationsRoot: string;
  private readonly quarantineRoot: string;
  private readonly userDataRoot: string;

  constructor(
    options: Readonly<WorkspaceBackupPlaintextQuarantineOptions>,
  ) {
    if (
      typeof options.userDataRoot !== 'string' ||
      options.userDataRoot.includes('\0') ||
      !isAbsolute(options.userDataRoot)
    ) {
      throw recoveryRequired();
    }
    this.userDataRoot = resolve(options.userDataRoot);
    this.operationsRoot = join(this.userDataRoot, 'workspace-operations');
    this.quarantineRoot = join(
      this.operationsRoot,
      quarantineDirectoryName,
    );
    if (
      !isDirectChild(this.userDataRoot, this.operationsRoot) ||
      !isDirectChild(this.operationsRoot, this.quarantineRoot)
    ) {
      throw recoveryRequired();
    }
  }

  async createPayloadPath(): Promise<string> {
    try {
      await this.ensurePrivateRoot();
      if ((await this.inspectEntries()).length !== 0) {
        throw recoveryRequired();
      }
      const fileName = `workspace-import-${randomUUID()}.payload`;
      if (!quarantineFileNamePattern.test(fileName)) {
        throw recoveryRequired();
      }
      const payloadPath = join(this.quarantineRoot, fileName);
      assertDirectCanonicalPayloadPath(this.quarantineRoot, payloadPath);
      await assertPathMissing(payloadPath);
      return payloadPath;
    } catch (error) {
      throw asRecoveryRequired(error);
    }
  }

  async removePayload(path: string): Promise<void> {
    try {
      await this.ensurePrivateRoot();
      assertDirectCanonicalPayloadPath(this.quarantineRoot, path);
      const entries = await this.inspectEntries();
      if (entries.length === 0) return;
      if (
        entries.length !== 1 ||
        !pathsEqual(entries[0]!, resolve(path))
      ) {
        throw recoveryRequired();
      }
      await rm(entries[0]!);
    } catch (error) {
      throw asRecoveryRequired(error);
    }
  }

  async recoverStalePayloads(): Promise<void> {
    try {
      await this.ensurePrivateRoot();
      const entries = await this.inspectEntries();
      for (const entry of entries) await rm(entry);
      if ((await this.inspectEntries()).length !== 0) {
        throw recoveryRequired();
      }
    } catch (error) {
      throw asRecoveryRequired(error);
    }
  }

  private async ensurePrivateRoot(): Promise<void> {
    await assertRealDirectory(this.userDataRoot, false);
    await ensurePrivateDirectory(
      this.userDataRoot,
      this.operationsRoot,
      false,
    );
    await ensurePrivateDirectory(
      this.operationsRoot,
      this.quarantineRoot,
      true,
    );
  }

  private async inspectEntries(): Promise<readonly string[]> {
    await assertRealDirectory(this.quarantineRoot, true);
    const names = await readdir(this.quarantineRoot);
    const paths: string[] = [];
    for (const name of names) {
      if (!quarantineFileNamePattern.test(name)) {
        throw recoveryRequired();
      }
      const path = join(this.quarantineRoot, name);
      assertDirectCanonicalPayloadPath(this.quarantineRoot, path);
      const metadata = await lstat(path, { bigint: true });
      if (
        !metadata.isFile() ||
        metadata.isSymbolicLink() ||
        metadata.nlink !== 1n ||
        metadata.size > maximumBackupCiphertextBytes ||
        (process.platform !== 'win32' && (metadata.mode & 0o077n) !== 0n) ||
        !pathsEqual(await realpath(path), path)
      ) {
        throw recoveryRequired();
      }
      paths.push(resolve(path));
    }
    return Object.freeze(paths.sort());
  }
}

async function ensurePrivateDirectory(
  parentPath: string,
  directoryPath: string,
  requirePrivateParent: boolean,
): Promise<void> {
  await assertRealDirectory(parentPath, requirePrivateParent);
  let created = false;
  try {
    await mkdir(directoryPath, { mode: 0o700 });
    created = true;
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'EEXIST') throw error;
  }
  if (created && process.platform !== 'win32') {
    await chmod(directoryPath, 0o700);
  }
  await assertRealDirectory(directoryPath, true);
}

async function assertRealDirectory(
  path: string,
  requirePrivateMode: boolean,
): Promise<void> {
  const metadata = await lstat(path, { bigint: true });
  if (
    !metadata.isDirectory() ||
    metadata.isSymbolicLink() ||
    (requirePrivateMode &&
      process.platform !== 'win32' &&
      (metadata.mode & 0o077n) !== 0n) ||
    !pathsEqual(await realpath(path), path)
  ) {
    throw recoveryRequired();
  }
}

function assertDirectCanonicalPayloadPath(root: string, path: string): void {
  const resolvedPath = resolve(path);
  if (
    !isDirectChild(root, resolvedPath) ||
    !quarantineFileNamePattern.test(basename(resolvedPath))
  ) {
    throw recoveryRequired();
  }
}

async function assertPathMissing(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
  throw recoveryRequired();
}

function isDirectChild(parentPath: string, childPath: string): boolean {
  const child = relative(resolve(parentPath), resolve(childPath));
  return (
    child.length > 0 &&
    !child.startsWith('..') &&
    !isAbsolute(child) &&
    !child.includes('/') &&
    !child.includes('\\')
  );
}

function pathsEqual(first: string, second: string): boolean {
  const left = resolve(first);
  const right = resolve(second);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

function asRecoveryRequired(error: unknown): WorkspaceBackupImportError {
  return error instanceof WorkspaceBackupImportError
    ? error
    : recoveryRequired();
}

function recoveryRequired(): WorkspaceBackupImportError {
  return new WorkspaceBackupImportError(
    'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
    'plaintextQuarantine',
  );
}
