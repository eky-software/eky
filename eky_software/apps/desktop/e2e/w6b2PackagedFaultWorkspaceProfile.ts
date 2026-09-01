import type { Stats } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  parseAcceptedBuildMetadata,
  type AcceptedBuildMetadata,
} from '../src/update/acceptedBuildMetadata.js';
import { acceptedBuildMetadataFileName } from '../src/update/acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from '../src/update/localUpdateRuntimePaths.js';
import {
  parseUpdateJournal,
  type UpdateJournal,
  type UpdateJournalState,
} from '../src/update/updateJournal.js';
import {
  maximumUpdateJournalBytes,
  updateJournalFileName,
} from '../src/update/updateJournalStore.js';
import {
  parseWorkspaceRegistryBytes,
  WORKSPACE_REGISTRY_MAX_BYTES,
} from '../src/workspaces/registry/workspaceRegistryBytes.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceLifecycleState,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import {
  snapshotW6b2PackagedWorkspaceEvidence,
  w6b2PackagedWorkspaceContentPreserved,
  type W6b2PackagedWorkspaceEvidence,
  type W6b2PackagedWorkspaceFileEvidence,
} from './w6b2PackagedWorkspaceEvidence.js';
import type { W6b2PackagedWorkspaceFixtureKey } from './w6b2PackagedWorkspaceBusinessFixture.js';
import { hydrateW6b2PackagedWorkspaceFixture } from './w6b2PackagedWorkspaceProfileFixture.js';
import type { W6b2PackagedFaultProfileOperation } from './w6b2PackagedWorkspaceProfileCommand.js';
import {
  readW6b2PackagedWorkspaceProfileState,
  w6b2PackagedWorkspaceFixtureKeys,
  type W6b2PackagedWorkspaceProfileState,
  type W6b2PersistedWorkspaceFixture,
} from './w6b2PackagedWorkspaceProfileState.js';

interface FaultExpectation {
  readonly acceptedVersion: '0.2.7' | '0.2.8';
  readonly changedDatabases: ReadonlySet<W6b2PackagedWorkspaceFixtureKey>;
  readonly cLifecycleState: WorkspaceLifecycleState;
  readonly journalState: UpdateJournalState;
}

export interface W6b2PackagedFaultWorkspaceSnapshot {
  readonly acceptedBuild: Readonly<AcceptedBuildMetadata> | undefined;
  readonly currentEvidence: ReadonlyMap<
    W6b2PackagedWorkspaceFixtureKey,
    Readonly<W6b2PackagedWorkspaceEvidence>
  >;
  readonly journal: Readonly<UpdateJournal> | undefined;
  readonly registry: Readonly<LocalWorkspaceRegistryV1>;
  readonly state: Readonly<W6b2PackagedWorkspaceProfileState>;
}

const maximumAcceptedBuildBytes = 4 * 1024;

const expectations = Object.freeze({
  verifyAcceptanceRecovery: Object.freeze({
    acceptedVersion: '0.2.8',
    changedDatabases: new Set<W6b2PackagedWorkspaceFixtureKey>(['A']),
    cLifecycleState: 'recoveryRequired',
    journalState: 'accepted',
  }),
  verifyActiveRollback: Object.freeze({
    acceptedVersion: '0.2.7',
    changedDatabases: new Set<W6b2PackagedWorkspaceFixtureKey>(),
    cLifecycleState: 'ready',
    journalState: 'rolledBack',
  }),
  verifyBinaryFailedSafe: Object.freeze({
    acceptedVersion: '0.2.7',
    changedDatabases: new Set<W6b2PackagedWorkspaceFixtureKey>(),
    cLifecycleState: 'ready',
    journalState: 'failedSafe',
  }),
  verifyPassiveRecovery: Object.freeze({
    acceptedVersion: '0.2.8',
    changedDatabases: new Set<W6b2PackagedWorkspaceFixtureKey>(['A']),
    cLifecycleState: 'recoveryRequired',
    journalState: 'accepted',
  }),
  verifyPreUpdateFailure: Object.freeze({
    acceptedVersion: '0.2.7',
    changedDatabases: new Set<W6b2PackagedWorkspaceFixtureKey>(),
    cLifecycleState: 'ready',
    journalState: 'failed',
  }),
} as const satisfies Readonly<
  Record<W6b2PackagedFaultProfileOperation, Readonly<FaultExpectation>>
>);

export async function verifyW6b2PackagedFaultWorkspaceProfile(input: {
  readonly operation: W6b2PackagedFaultProfileOperation;
  readonly proofRoot: string;
  readonly userDataRoot: string;
}): Promise<void> {
  const state = await readW6b2PackagedWorkspaceProfileState(input.proofRoot);
  const currentEvidence = new Map<
    W6b2PackagedWorkspaceFixtureKey,
    Readonly<W6b2PackagedWorkspaceEvidence>
  >();
  for (const persisted of state.fixtures) {
    const fixture = hydrateW6b2PackagedWorkspaceFixture(
      input.userDataRoot,
      persisted,
    );
    currentEvidence.set(
      fixture.fixtureKey,
      await snapshotW6b2PackagedWorkspaceEvidence(fixture),
    );
  }

  const runtimePaths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: join(input.userDataRoot, 'runtime'),
    userDataPath: input.userDataRoot,
  });
  const registryPath = join(
    input.userDataRoot,
    WORKSPACE_REGISTRY_FILE_NAME,
  );
  const acceptedBuildPath = runtimePaths.acceptedBuildMetadataPath;
  const journalPath = runtimePaths.journalPath;
  requireExpectedFileNames(acceptedBuildPath, journalPath);

  const [registryBytes, acceptedBuildBytes, journalBytes] = await Promise.all([
    readStrictPrivateFile(
      registryPath,
      input.userDataRoot,
      WORKSPACE_REGISTRY_MAX_BYTES,
    ),
    readStrictPrivateFile(
      acceptedBuildPath,
      input.userDataRoot,
      maximumAcceptedBuildBytes,
    ),
    readStrictPrivateFile(
      journalPath,
      input.userDataRoot,
      maximumUpdateJournalBytes,
    ),
  ]);
  await Promise.all([
    requireRecoverySlotsAbsent(registryPath),
    requireRecoverySlotsAbsent(acceptedBuildPath),
    requireRecoverySlotsAbsent(journalPath),
  ]);

  assertW6b2PackagedFaultWorkspaceState({
    acceptedBuild: parseAcceptedBuildMetadata(
      parseJsonBytes(acceptedBuildBytes),
    ),
    currentEvidence,
    journal: parseUpdateJournal(parseJsonBytes(journalBytes)),
    operation: input.operation,
    registry: parseWorkspaceRegistryBytes(registryBytes),
    state,
  });
}

export function assertW6b2PackagedFaultWorkspaceState(
  input: Readonly<
    W6b2PackagedFaultWorkspaceSnapshot & {
      readonly operation: W6b2PackagedFaultProfileOperation;
    }
  >,
): void {
  const expectation = expectations[input.operation];
  requireEvidence(input, expectation);
  requireRegistry(input, expectation);
  requireAcceptedBuild(input, expectation);
  requireJournal(input, expectation);
}

function requireEvidence(
  input: Readonly<W6b2PackagedFaultWorkspaceSnapshot>,
  expectation: Readonly<FaultExpectation>,
): void {
  for (const fixtureKey of w6b2PackagedWorkspaceFixtureKeys) {
    const persisted = requirePersistedFixture(input.state, fixtureKey);
    const current = input.currentEvidence.get(fixtureKey);
    if (
      current === undefined ||
      !w6b2PackagedWorkspaceContentPreserved(persisted.baseline, current) ||
      !runtimeFilesAreExact(persisted.baseline, current)
    ) {
      throw new Error('W6B2_FAULT_PROFILE_CONTENT_INVALID');
    }
    const databaseChanged =
      current.database.sha256 !== persisted.baseline.database.sha256;
    if (
      databaseChanged !== expectation.changedDatabases.has(fixtureKey) ||
      (!databaseChanged &&
        current.database.size !== persisted.baseline.database.size)
    ) {
      throw new Error('W6B2_FAULT_PROFILE_DATABASE_INVALID');
    }
  }
}

function requireRegistry(
  input: Readonly<W6b2PackagedFaultWorkspaceSnapshot>,
  expectation: Readonly<FaultExpectation>,
): void {
  const fixtureA = requirePersistedFixture(input.state, 'A');
  if (
    input.registry.formatVersion !== 1 ||
    input.registry.activeWorkspaceId !== fixtureA.workspaceId ||
    input.registry.workspaces.length !== 3
  ) {
    throw new Error('W6B2_FAULT_PROFILE_REGISTRY_INVALID');
  }
  for (const [index, fixtureKey] of w6b2PackagedWorkspaceFixtureKeys.entries()) {
    const persisted = requirePersistedFixture(input.state, fixtureKey);
    const entries = input.registry.workspaces.filter(
      (entry) => entry.workspaceId === persisted.workspaceId,
    );
    const entry = entries[0];
    const lifecycleState =
      fixtureKey === 'C' ? expectation.cLifecycleState : 'ready';
    if (
      entries.length !== 1 ||
      entry === undefined ||
      entry.layoutVersion !== 1 ||
      entry.lifecycleState !== lifecycleState ||
      entry.lineageIdentity.formatVersion !== 1 ||
      entry.lineageIdentity.profileId !== persisted.profileId ||
      entry.workspaceLabel !== `First-start workspace ${index + 1}`
    ) {
      throw new Error('W6B2_FAULT_PROFILE_REGISTRY_INVALID');
    }
  }
}

function requireAcceptedBuild(
  input: Readonly<W6b2PackagedFaultWorkspaceSnapshot>,
  expectation: Readonly<FaultExpectation>,
): void {
  if (
    input.acceptedBuild?.formatVersion !== 1 ||
    input.acceptedBuild.appVersion !== expectation.acceptedVersion ||
    input.acceptedBuild.buildRevision !== input.state.buildRevision ||
    input.acceptedBuild.releaseChannel !== 'pilot'
  ) {
    throw new Error('W6B2_FAULT_PROFILE_ACCEPTED_BUILD_INVALID');
  }
}

function requireJournal(
  input: Readonly<W6b2PackagedFaultWorkspaceSnapshot>,
  expectation: Readonly<FaultExpectation>,
): void {
  if (
    input.journal?.formatVersion !== 1 ||
    input.journal.state !== expectation.journalState ||
    input.journal.currentVersion !== input.state.sourceVersion ||
    input.journal.targetVersion !== input.state.targetVersion ||
    input.journal.releaseChannel !== 'pilot' ||
    input.journal.currentPackageIdentity.buildRevision !==
      input.state.buildRevision ||
    input.journal.candidatePackageIdentity.buildRevision !==
      input.state.buildRevision
  ) {
    throw new Error('W6B2_FAULT_PROFILE_JOURNAL_INVALID');
  }
}

function requirePersistedFixture(
  state: Readonly<W6b2PackagedWorkspaceProfileState>,
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Readonly<W6b2PersistedWorkspaceFixture> {
  const fixture = state.fixtures.find(
    (candidate) => candidate.fixtureKey === fixtureKey,
  );
  if (fixture === undefined) throw new Error('W6B2_FAULT_PROFILE_STATE_INVALID');
  return fixture;
}

function runtimeFilesAreExact(
  before: Readonly<W6b2PackagedWorkspaceEvidence>,
  after: Readonly<W6b2PackagedWorkspaceEvidence>,
): boolean {
  return (
    fileEvidenceEquals(before.archiveConfig, after.archiveConfig) &&
    fileEvidenceEquals(before.archiveJournal, after.archiveJournal) &&
    fileEvidenceEquals(before.archiveSentinel, after.archiveSentinel) &&
    fileEvidenceEquals(before.pdf, after.pdf) &&
    fileEvidenceEquals(before.recoverySentinel, after.recoverySentinel) &&
    fileEvidenceEquals(before.secretSentinel, after.secretSentinel)
  );
}

function fileEvidenceEquals(
  left: Readonly<W6b2PackagedWorkspaceFileEvidence>,
  right: Readonly<W6b2PackagedWorkspaceFileEvidence>,
): boolean {
  return left.sha256 === right.sha256 && left.size === right.size;
}

async function readStrictPrivateFile(
  path: string,
  root: string,
  maximumBytes: number,
): Promise<Uint8Array> {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  requireContainedPath(resolvedRoot, resolvedPath);
  const rootMetadata = await lstat(resolvedRoot);
  if (
    !rootMetadata.isDirectory() ||
    rootMetadata.isSymbolicLink() ||
    !samePath(await realpath(resolvedRoot), resolvedRoot)
  ) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
  const pathMetadata = await lstat(resolvedPath);
  requirePrivateFile(pathMetadata, maximumBytes);
  if (!samePath(await realpath(resolvedPath), resolvedPath)) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
  const handle = await open(resolvedPath, 'r');
  try {
    const openedMetadata = await handle.stat();
    requirePrivateFile(openedMetadata, maximumBytes);
    requireSameFile(pathMetadata, openedMetadata);
    const bytes = await handle.readFile();
    const [openedAfter, pathAfter, canonicalAfter] = await Promise.all([
      handle.stat(),
      lstat(resolvedPath),
      realpath(resolvedPath),
    ]);
    requirePrivateFile(openedAfter, maximumBytes);
    requirePrivateFile(pathAfter, maximumBytes);
    requireSameFile(pathMetadata, openedAfter);
    requireSameFile(pathMetadata, pathAfter);
    if (
      bytes.byteLength !== openedAfter.size ||
      !samePath(canonicalAfter, resolvedPath)
    ) {
      throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
    }
    return bytes;
  } finally {
    await handle.close();
  }
}

function requirePrivateFile(metadata: Stats, maximumBytes: number): void {
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    metadata.nlink !== 1 ||
    metadata.size < 1 ||
    metadata.size > maximumBytes
  ) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
}

function requireSameFile(left: Stats, right: Stats): void {
  if (
    left.dev !== right.dev ||
    left.ino !== right.ino ||
    left.mode !== right.mode ||
    left.nlink !== right.nlink ||
    left.size !== right.size ||
    left.birthtimeMs !== right.birthtimeMs ||
    left.ctimeMs !== right.ctimeMs ||
    left.mtimeMs !== right.mtimeMs
  ) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
}

async function requireRecoverySlotsAbsent(path: string): Promise<void> {
  await Promise.all([`${path}.next`, `${path}.backup`].map(requireMissing));
}

async function requireMissing(path: string): Promise<void> {
  try {
    await lstat(path);
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw error;
  }
}

function requireExpectedFileNames(
  acceptedBuildPath: string,
  journalPath: string,
): void {
  if (
    !acceptedBuildPath.endsWith(acceptedBuildMetadataFileName) ||
    !journalPath.endsWith(updateJournalFileName)
  ) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
}

function parseJsonBytes(bytes: Uint8Array): unknown {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
}

function requireContainedPath(root: string, candidate: string): void {
  if (!isAbsolute(root) || !isAbsolute(candidate)) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
  const child = relative(root, candidate);
  if (
    child === '' ||
    child === '..' ||
    child.startsWith(`..${sep}`) ||
    isAbsolute(child)
  ) {
    throw new Error('W6B2_FAULT_PROFILE_FILE_INVALID');
  }
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
