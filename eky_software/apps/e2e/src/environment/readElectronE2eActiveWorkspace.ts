import { lstatSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const workspaceIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const profileIdPattern = /^[0-9a-f]{64}$/;
const maximumRegistryBytes = 64 * 1_024;

export interface ElectronE2eActiveWorkspacePaths {
  readonly archiveJournalPath: string;
  readonly databaseFilePath: string;
  readonly documentsRoot: string;
  readonly emailSecretFilePath: string;
  readonly profileId: string;
  readonly runtimeRoot: string;
  readonly workspaceId: string;
  readonly workspaceRoot: string;
}

export function readElectronE2eActiveWorkspace(
  userDataPath: string,
): Readonly<ElectronE2eActiveWorkspacePaths> {
  const canonicalUserDataPath = resolve(userDataPath);
  const registryPath = join(
    canonicalUserDataPath,
    'workspace-registry-v1.json',
  );
  const registryStat = lstatSync(registryPath);
  if (
    !registryStat.isFile() ||
    registryStat.isSymbolicLink() ||
    registryStat.size > maximumRegistryBytes
  ) {
    throw new Error('Electron E2E workspace registry is invalid.');
  }

  const registry = parseRegistry(readFileSync(registryPath, 'utf8'));
  const activeWorkspaceId = registry.activeWorkspaceId;
  const activeWorkspaceEntry = registry.workspaces.find(
    (entry) =>
      isRecord(entry) &&
      entry.workspaceId === activeWorkspaceId &&
      entry.layoutVersion === 1,
  );
  const lineageIdentity = isRecord(activeWorkspaceEntry)
    ? activeWorkspaceEntry.lineageIdentity
    : undefined;
  if (
    typeof activeWorkspaceId !== 'string' ||
    !workspaceIdPattern.test(activeWorkspaceId) ||
    !isRecord(activeWorkspaceEntry) ||
    !isRecord(lineageIdentity) ||
    lineageIdentity.formatVersion !== 1 ||
    typeof lineageIdentity.profileId !== 'string' ||
    !profileIdPattern.test(lineageIdentity.profileId)
  ) {
    throw new Error('Electron E2E active workspace is invalid.');
  }

  const workspacesRoot = join(canonicalUserDataPath, 'workspaces');
  const workspaceRoot = join(workspacesRoot, activeWorkspaceId);
  const relativeWorkspacePath = relative(workspacesRoot, workspaceRoot);
  if (
    relativeWorkspacePath === '' ||
    relativeWorkspacePath === '..' ||
    relativeWorkspacePath.startsWith(
      `..${process.platform === 'win32' ? '\\' : '/'}`,
    )
  ) {
    throw new Error('Electron E2E workspace path escapes its root.');
  }
  const workspaceStat = lstatSync(workspaceRoot);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    throw new Error('Electron E2E workspace root is invalid.');
  }

  const runtimeRoot = join(workspaceRoot, 'runtime');
  return Object.freeze({
    archiveJournalPath: join(
      runtimeRoot,
      'archive',
      'invoice-pdf-archive-journal-v1.json',
    ),
    databaseFilePath: join(runtimeRoot, 'data', 'eky.sqlite'),
    documentsRoot: join(runtimeRoot, 'storage', 'invoices'),
    emailSecretFilePath: join(
      runtimeRoot,
      'secrets',
      'company-email-smtp-v1.dat',
    ),
    profileId: lineageIdentity.profileId,
    runtimeRoot,
    workspaceId: activeWorkspaceId,
    workspaceRoot,
  });
}

function parseRegistry(serialized: string): {
  readonly activeWorkspaceId: unknown;
  readonly workspaces: readonly unknown[];
} {
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    throw new Error('Electron E2E workspace registry is invalid.');
  }
  if (!isRecord(value) || !Array.isArray(value.workspaces)) {
    throw new Error('Electron E2E workspace registry is invalid.');
  }
  return {
    activeWorkspaceId: value.activeWorkspaceId,
    workspaces: value.workspaces,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
