import { createHash, randomUUID } from 'node:crypto';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { startDesktopComposition } from '../src/main/desktopComposition.js';
import { resolveDesktopWorkspaceStartup } from '../src/main/resolveDesktopWorkspaceStartup.js';
import { AcceptedBuildMetadataStore } from '../src/update/acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from '../src/update/localUpdateRuntimePaths.js';
import { WorkspaceLegacyAdoptionJournalStore } from '../src/workspaces/adoption/workspaceLegacyAdoptionJournal.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { resolveActiveWorkspaceStartup } from '../src/workspaces/runtime/resolveActiveWorkspaceStartup.js';
import type {
  WorkspaceStartupRecoveryProofInput,
  WorkspaceStartupRecoveryProofResult,
  WorkspaceStartupRecoveryProofStage,
} from './workspaceStartupRecoveryProofTypes.js';

const acceptedRevision = 'a'.repeat(40);
const rejectedRevision = 'b'.repeat(40);
const proofProfileId = 'c'.repeat(64);
const proofUpgradeCode = '11111111-1111-4111-8111-111111111111';

export async function runWorkspaceStartupRecoveryProof(
  input: Readonly<WorkspaceStartupRecoveryProofInput>,
): Promise<Readonly<WorkspaceStartupRecoveryProofResult>> {
  const proofRoot = await mkdtemp(
    join(input.userDataRoot, 'workspace-startup-proof-'),
  );
  let stage: WorkspaceStartupRecoveryProofStage = 'buildAdmission';

  try {
    const admission = await proveBuildAdmission({
      ...input,
      userDataRoot: join(proofRoot, 'admission'),
    });
    stage = 'historicalFixture';
    const historicalRoot = join(proofRoot, 'historical');
    const legacyArtifacts = await createLegacyArtifacts(historicalRoot);
    const firstAdoption = await resolveActiveWorkspaceStartup(historicalRoot);
    const unpublishedWorkspaceRoot = firstAdoption.workspaceRoot;
    await firstAdoption.recoverFromFailure();

    const registry = new WorkspaceRegistryStore({
      installationRoot: historicalRoot,
      filePath: join(historicalRoot, WORKSPACE_REGISTRY_FILE_NAME),
    });
    requireProof(
      (await registry.read()) === undefined,
      'WORKSPACE_STARTUP_RECOVERY_PROOF_REGISTRY_PUBLISHED_EARLY',
    );

    stage = 'historicalRecovery';
    let relaunchCount = 0;
    const recovery = await resolveDesktopWorkspaceStartup({
      createRuntimeSession: () => 'not-created-during-recovery',
      relaunchApplication: () => {
        relaunchCount += 1;
      },
      resolveActiveWorkspace: resolveActiveWorkspaceStartup,
      userDataRoot: historicalRoot,
    });
    requireProof(
      recovery.status === 'relaunching',
      'WORKSPACE_STARTUP_RECOVERY_PROOF_RELAUNCH_MISSING',
    );
    const historicalCopyDiscarded = !(await pathExists(
      unpublishedWorkspaceRoot,
    ));
    const adoptionJournal = new WorkspaceLegacyAdoptionJournalStore(
      historicalRoot,
    );
    const historicalJournalCleared =
      (await adoptionJournal.read()) === undefined;

    stage = 'historicalReadoption';
    let sessionCreationCount = 0;
    const readoption = await resolveDesktopWorkspaceStartup({
      createRuntimeSession: () => {
        sessionCreationCount += 1;
        return 'synthetic-runtime-session';
      },
      relaunchApplication: () => {
        relaunchCount += 1;
      },
      resolveActiveWorkspace: resolveActiveWorkspaceStartup,
      userDataRoot: historicalRoot,
    });
    requireProof(
      readoption.status === 'ready' && readoption.activeWorkspace.mode === 'adoption',
      'WORKSPACE_STARTUP_RECOVERY_PROOF_READOPTION_MISSING',
    );
    const registryAbsentBeforeAcceptance =
      (await registry.read()) === undefined;
    const readoptedArtifactsBeforeAcceptance = await hashArtifacts({
      databasePath: join(
        readoption.activeWorkspace.workspaceRoot,
        'runtime',
        'data',
        'eky.sqlite',
      ),
      pdfPath: join(
        readoption.activeWorkspace.workspaceRoot,
        'runtime',
        'storage',
        'invoices',
        'approved-invoice.pdf',
      ),
    });
    await readoption.activeWorkspace.accept(proofProfileId);
    const publishedRegistry = await registry.read();
    const registryPublishedOnlyAfterAcceptance =
      registryAbsentBeforeAcceptance &&
      publishedRegistry?.activeWorkspaceId ===
        readoption.activeWorkspace.workspaceId &&
      publishedRegistry.workspaces.length === 1;

    const normalStartup = await resolveActiveWorkspaceStartup(historicalRoot);
    requireProof(
      normalStartup.mode === 'normal' &&
        normalStartup.workspaceId === readoption.activeWorkspace.workspaceId,
      'WORKSPACE_STARTUP_RECOVERY_PROOF_NORMAL_STARTUP_MISSING',
    );
    await normalStartup.accept(proofProfileId);
    const legacyArtifactsAfter = await hashArtifacts(legacyArtifacts.paths);
    const readoptedArtifactsAfter = await hashArtifacts({
      databasePath: join(
        normalStartup.workspaceRoot,
        'runtime',
        'data',
        'eky.sqlite',
      ),
      pdfPath: join(
        normalStartup.workspaceRoot,
        'runtime',
        'storage',
        'invoices',
        'approved-invoice.pdf',
      ),
    });

    stage = 'result';
    const result = {
      ...admission,
      historicalCopyDiscarded,
      historicalJournalCleared,
      legacyArtifactsPreserved:
        legacyArtifacts.hash === legacyArtifactsAfter,
      readoptionArtifactsMatch:
        legacyArtifacts.hash === readoptedArtifactsBeforeAcceptance &&
        legacyArtifacts.hash === readoptedArtifactsAfter,
      registryPublishedOnlyAfterAcceptance,
      relaunchCount,
    } as const;
    requireProofResult(result, sessionCreationCount);
    return Object.freeze(result);
  } catch (error) {
    const errorCode = readSafeErrorCode(error);
    throw new Error(
      `WORKSPACE_STARTUP_RECOVERY_PROOF_FAILED_${stage.toUpperCase()}_${errorCode}`,
    );
  } finally {
    await rm(proofRoot, { force: true, recursive: true });
  }
}

async function proveBuildAdmission(
  input: Readonly<WorkspaceStartupRecoveryProofInput>,
): Promise<
  Pick<
    WorkspaceStartupRecoveryProofResult,
    | 'admissionRejectedBeforeWorkspaceResolution'
    | 'admissionSideEffectsAbsent'
  >
> {
  await mkdir(input.userDataRoot, { mode: 0o700, recursive: true });
  const updatePaths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: join(input.userDataRoot, 'runtime'),
    userDataPath: input.userDataRoot,
  });
  await new AcceptedBuildMetadataStore(
    updatePaths.acceptedBuildMetadataPath,
  ).write({
    acceptedAt: '2026-08-20T00:00:00.000Z',
    appVersion: input.appVersion,
    buildRevision: acceptedRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });

  let workspaceResolutionCount = 0;
  let backendStartCount = 0;
  let caught: unknown;
  try {
    await startDesktopComposition({
      appVersion: input.appVersion,
      applicationPath: process.execPath,
      buildInfo: {
        appVersion: input.appVersion,
        buildCreatedAt: '2026-08-20T00:01:00.000Z',
        buildDirty: false,
        buildRevision: rejectedRevision,
        schemaVersion: 1,
      },
      dependencies: {
        async resolveActiveWorkspace() {
          workspaceResolutionCount += 1;
          throw new Error('WORKSPACE_RESOLUTION_MUST_NOT_RUN');
        },
        async startBackend() {
          backendStartCount += 1;
          throw new Error('BACKEND_MUST_NOT_START');
        },
      },
      quitApplication: () => undefined,
      relaunchApplication: () => undefined,
      releaseInfo: {
        appIdentity: 'Eky',
        appVersion: input.appVersion,
        architecture: 'x64',
        buildRevision: rejectedRevision,
        msiProductVersion: input.appVersion,
        platform: 'win32',
        releaseChannel: 'pilot',
        schemaVersion: 1,
        upgradeCode: proofUpgradeCode,
      },
      reportSmokeStage: async () => undefined,
      resourcesPath: input.resourcesPath,
      runtimeInstanceId: randomUUID(),
      smokeConfiguration: {
        enabled: false,
        phase: 'initial',
        root: undefined,
        userDataPath: undefined,
      },
      userDataPath: input.userDataRoot,
    });
  } catch (error) {
    caught = error;
  }

  const adoptionJournal = new WorkspaceLegacyAdoptionJournalStore(
    input.userDataRoot,
  );
  const admissionRejectedBeforeWorkspaceResolution =
    caught instanceof Error &&
    caught.message === 'DESKTOP_BUILD_ADMISSION_REJECTED' &&
    workspaceResolutionCount === 0 &&
    backendStartCount === 0;
  const admissionSideEffectsAbsent =
    (await adoptionJournal.read()) === undefined &&
    !(await pathExists(join(input.userDataRoot, WORKSPACE_REGISTRY_FILE_NAME))) &&
    !(await pathExists(join(input.userDataRoot, 'workspace-operations'))) &&
    !(await pathExists(join(input.userDataRoot, 'workspaces')));

  return Object.freeze({
    admissionRejectedBeforeWorkspaceResolution,
    admissionSideEffectsAbsent,
  });
}

async function createLegacyArtifacts(userDataRoot: string): Promise<{
  readonly hash: string;
  readonly paths: { readonly databasePath: string; readonly pdfPath: string };
}> {
  const paths = {
    databasePath: join(userDataRoot, 'runtime', 'data', 'eky.sqlite'),
    pdfPath: join(
      userDataRoot,
      'runtime',
      'storage',
      'invoices',
      'approved-invoice.pdf',
    ),
  } as const;
  await writePrivateFile(paths.databasePath, 'synthetic-sqlite-profile');
  await writePrivateFile(paths.pdfPath, '%PDF-1.7\nsynthetic invoice');
  return Object.freeze({
    hash: await hashArtifacts(paths),
    paths,
  });
}

async function writePrivateFile(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  await writeFile(path, content, { encoding: 'utf8', mode: 0o600 });
}

async function hashArtifacts(input: {
  readonly databasePath: string;
  readonly pdfPath: string;
}): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await readFile(input.databasePath));
  hash.update(await readFile(input.pdfPath));
  return hash.digest('hex');
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function requireProof(condition: boolean, errorCode: string): asserts condition {
  if (!condition) throw new Error(errorCode);
}

function requireProofResult(
  result: Readonly<WorkspaceStartupRecoveryProofResult>,
  sessionCreationCount: number,
): void {
  if (
    !result.admissionRejectedBeforeWorkspaceResolution ||
    !result.admissionSideEffectsAbsent ||
    !result.historicalCopyDiscarded ||
    !result.historicalJournalCleared ||
    !result.legacyArtifactsPreserved ||
    !result.readoptionArtifactsMatch ||
    !result.registryPublishedOnlyAfterAcceptance ||
    result.relaunchCount !== 1 ||
    sessionCreationCount !== 1
  ) {
    throw new Error('WORKSPACE_STARTUP_RECOVERY_PROOF_RESULT_INVALID');
  }
}

function readSafeErrorCode(error: unknown): string {
  const errorCode = error instanceof Error ? error.message : undefined;
  return errorCode !== undefined && /^[A-Z][A-Z0-9_]{1,120}$/u.test(errorCode)
    ? errorCode
    : 'UNKNOWN';
}
