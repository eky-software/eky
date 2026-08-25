import { join } from 'node:path';

import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { AcceptedBuildMetadataStore } from '../src/update/acceptedBuildMetadataStore.js';
import { createLocalUpdateRuntimePaths } from '../src/update/localUpdateRuntimePaths.js';
import { WORKSPACE_REGISTRY_FILE_NAME } from '../src/workspaces/registry/workspaceRegistryPaths.js';
import { WorkspaceRegistryStore } from '../src/workspaces/registry/workspaceRegistryStore.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../src/workspaces/runtime/workspaceCandidateRuntimePaths.js';
import {
  snapshotW6b2PackagedWorkspaceEvidence,
  w6b2PackagedWorkspaceContentPreserved,
  type W6b2PackagedWorkspaceEvidence,
} from './w6b2PackagedWorkspaceEvidence.js';
import {
  createW6b2PackagedWorkspaceFixture,
  type W6b2PackagedWorkspaceFixture,
  type W6b2PackagedWorkspaceFixtureKey,
} from './w6b2PackagedWorkspaceFixtures.js';
import { invalidateW6b2PackagedWorkspaceMigrationHistory } from './w6b2PackagedWorkspaceMigrationHistory.js';
import { hydrateW6b2PackagedWorkspaceFixture } from './w6b2PackagedWorkspaceProfileFixture.js';
import {
  readW6b2PackagedWorkspaceProfileInput,
  readW6b2PackagedWorkspaceProfileState,
  w6b2PackagedWorkspaceFixtureKeys,
  writeW6b2PackagedWorkspaceProfileState,
  type W6b2PackagedWorkspaceProfileState,
  type W6b2PersistedWorkspaceFixture,
} from './w6b2PackagedWorkspaceProfileState.js';
import { createWorkspaceFirstStartProofRegistry } from './workspaceFirstStartMigrationProofFixtures.js';

export type W6b2PackagedWorkspaceVerificationPhase =
  | 'targetFirstStart'
  | 'verifyBRestart'
  | 'rejectC';

export async function prepareW6b2PackagedWorkspaceProfile(input: {
  readonly proofRoot: string;
  readonly resourcesPath: string;
  readonly userDataRoot: string;
}): Promise<void> {
  const profileInput = await readW6b2PackagedWorkspaceProfileInput(
    input.proofRoot,
  );
  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    input.resourcesPath,
  );
  const factory = new ElectronWorkspaceCandidateRuntimeFactory({
    appVersion: '0.2.7',
    backendRoot: runtimePaths.backendRoot,
    buildRevision: profileInput.sourceBuildRevision,
    migrationsDirectory: runtimePaths.migrationsDirectory,
    runnerPath: runtimePaths.runnerPath,
  });
  const fixtures: Readonly<W6b2PackagedWorkspaceFixture>[] = [];
  for (const fixtureKey of w6b2PackagedWorkspaceFixtureKeys) {
    fixtures.push(
      await createW6b2PackagedWorkspaceFixture({
        factory,
        fixtureKey,
        userDataRoot: input.userDataRoot,
      }),
    );
  }
  await invalidateW6b2PackagedWorkspaceMigrationHistory({
    fixture: requireFixture(fixtures, 'C'),
    targetFactory: factory,
  });
  await writeInitialRegistry(input.userDataRoot, fixtures);
  await writeAcceptedSourceBuild(
    input.userDataRoot,
    profileInput.sourceBuildRevision,
  );

  const persistedFixtures: W6b2PersistedWorkspaceFixture[] = [];
  for (const fixture of fixtures) {
    persistedFixtures.push(
      Object.freeze({
        baseline: await snapshotW6b2PackagedWorkspaceEvidence(fixture),
        business: fixture.business,
        fixtureKey: fixture.fixtureKey,
        profileId: fixture.profileId,
        workspaceId: fixture.workspaceId,
      }),
    );
  }
  await writeW6b2PackagedWorkspaceProfileState(input.proofRoot, {
    buildRevision: profileInput.sourceBuildRevision,
    fixtures: Object.freeze(persistedFixtures),
    formatVersion: 1,
    sourceVersion: '0.2.7',
    targetVersion: '0.2.8',
  });
}

export async function verifyW6b2PackagedWorkspaceProfile(input: {
  readonly phase: W6b2PackagedWorkspaceVerificationPhase;
  readonly proofRoot: string;
  readonly userDataRoot: string;
}): Promise<void> {
  const state = await readW6b2PackagedWorkspaceProfileState(input.proofRoot);
  const fixtures = state.fixtures.map((fixture) =>
    hydrateW6b2PackagedWorkspaceFixture(input.userDataRoot, fixture),
  );
  const currentEvidence = new Map<
    W6b2PackagedWorkspaceFixtureKey,
    Readonly<W6b2PackagedWorkspaceEvidence>
  >();
  for (const fixture of fixtures) {
    const evidence = await snapshotW6b2PackagedWorkspaceEvidence(fixture);
    const baseline = requirePersistedFixture(
      state.fixtures,
      fixture.fixtureKey,
    ).baseline;
    if (!w6b2PackagedWorkspaceContentPreserved(baseline, evidence)) {
      throw new Error('W6B2_PROFILE_CONTENT_CHANGED');
    }
    currentEvidence.set(fixture.fixtureKey, evidence);
  }
  requireDatabaseTransition(state, currentEvidence, input.phase);
  await requireRegistryState(input.userDataRoot, fixtures, input.phase);
  await requireAcceptedTargetBuild(input.userDataRoot, state.buildRevision);
}

async function writeInitialRegistry(
  userDataRoot: string,
  fixtures: readonly Readonly<W6b2PackagedWorkspaceFixture>[],
): Promise<void> {
  await new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  }).write(
    createWorkspaceFirstStartProofRegistry(
      fixtures,
      requireFixture(fixtures, 'A').workspaceId,
    ),
  );
}

async function writeAcceptedSourceBuild(
  userDataRoot: string,
  buildRevision: string,
): Promise<void> {
  const profile = createDesktopProfilePaths(userDataRoot);
  const paths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: profile.runtimeRoot,
    userDataPath: userDataRoot,
  });
  await new AcceptedBuildMetadataStore(paths.acceptedBuildMetadataPath).write({
    acceptedAt: '2026-08-22T00:00:00.000Z',
    appVersion: '0.2.7',
    buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
}

async function requireRegistryState(
  userDataRoot: string,
  fixtures: readonly Readonly<W6b2PackagedWorkspaceFixture>[],
  phase: W6b2PackagedWorkspaceVerificationPhase,
): Promise<void> {
  const registry = await new WorkspaceRegistryStore({
    filePath: join(userDataRoot, WORKSPACE_REGISTRY_FILE_NAME),
    installationRoot: userDataRoot,
  }).read();
  const activeFixture = requireFixture(
    fixtures,
    phase === 'verifyBRestart' ? 'B' : 'A',
  );
  const invalidFixture = requireFixture(fixtures, 'C');
  if (
    registry === undefined ||
    registry.workspaces.length !== 3 ||
    registry.activeWorkspaceId !== activeFixture.workspaceId ||
    registry.workspaces.find(
      (entry) => entry.workspaceId === invalidFixture.workspaceId,
    )?.lifecycleState !== 'recoveryRequired'
  ) {
    throw new Error('W6B2_PROFILE_REGISTRY_INVALID');
  }
}

async function requireAcceptedTargetBuild(
  userDataRoot: string,
  buildRevision: string,
): Promise<void> {
  const profile = createDesktopProfilePaths(userDataRoot);
  const paths = createLocalUpdateRuntimePaths({
    legacyRuntimeRoot: profile.runtimeRoot,
    userDataPath: userDataRoot,
  });
  const accepted = await new AcceptedBuildMetadataStore(
    paths.acceptedBuildMetadataPath,
  ).read();
  if (
    accepted?.appVersion !== '0.2.8' ||
    accepted.buildRevision !== buildRevision ||
    accepted.releaseChannel !== 'pilot'
  ) {
    throw new Error('W6B2_PROFILE_ACCEPTED_BUILD_INVALID');
  }
}

function requireDatabaseTransition(
  state: Readonly<W6b2PackagedWorkspaceProfileState>,
  current: ReadonlyMap<
    W6b2PackagedWorkspaceFixtureKey,
    Readonly<W6b2PackagedWorkspaceEvidence>
  >,
  phase: W6b2PackagedWorkspaceVerificationPhase,
): void {
  for (const fixtureKey of w6b2PackagedWorkspaceFixtureKeys) {
    const before = requirePersistedFixture(state.fixtures, fixtureKey).baseline
      .database.sha256;
    const after = current.get(fixtureKey)?.database.sha256;
    const shouldChange =
      fixtureKey === 'A' ||
      (fixtureKey === 'B' && phase !== 'targetFirstStart');
    if (
      after === undefined ||
      (shouldChange ? after === before : after !== before)
    ) {
      throw new Error('W6B2_PROFILE_MIGRATION_TRANSITION_INVALID');
    }
  }
}

function requireFixture(
  fixtures: readonly Readonly<W6b2PackagedWorkspaceFixture>[],
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Readonly<W6b2PackagedWorkspaceFixture> {
  const fixture = fixtures.find(
    (candidate) => candidate.fixtureKey === fixtureKey,
  );
  if (fixture === undefined) throw new Error('W6B2_PROFILE_STATE_INVALID');
  return fixture;
}

function requirePersistedFixture(
  fixtures: readonly Readonly<W6b2PersistedWorkspaceFixture>[],
  fixtureKey: W6b2PackagedWorkspaceFixtureKey,
): Readonly<W6b2PersistedWorkspaceFixture> {
  const fixture = fixtures.find(
    (candidate) => candidate.fixtureKey === fixtureKey,
  );
  if (fixture === undefined) throw new Error('W6B2_PROFILE_STATE_INVALID');
  return fixture;
}
