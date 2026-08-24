import type { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import {
  customizeW6b2PackagedWorkspaceBusinessFixture,
  type W6b2PackagedWorkspaceFixtureKey,
} from './w6b2PackagedWorkspaceBusinessFixture.js';
import {
  createW6b2PackagedWorkspaceRuntimeNamespaces,
  type W6b2PackagedWorkspaceRuntimeNamespaces,
} from './w6b2PackagedWorkspaceRuntimeNamespaces.js';
import {
  createWorkspaceFirstStartProofFixture,
  type WorkspaceFirstStartProofFixture,
} from './workspaceFirstStartMigrationProofFixtures.js';

export interface W6b2PackagedWorkspaceFixture
  extends WorkspaceFirstStartProofFixture,
    W6b2PackagedWorkspaceRuntimeNamespaces {
  readonly fixtureKey: W6b2PackagedWorkspaceFixtureKey;
}

export async function createW6b2PackagedWorkspaceFixture(input: {
  readonly factory: ElectronWorkspaceCandidateRuntimeFactory;
  readonly fixtureKey: W6b2PackagedWorkspaceFixtureKey;
  readonly userDataRoot: string;
}): Promise<Readonly<W6b2PackagedWorkspaceFixture>> {
  const fixture = await createWorkspaceFirstStartProofFixture({
    factory: input.factory,
    userDataRoot: input.userDataRoot,
  });
  const business = await customizeW6b2PackagedWorkspaceBusinessFixture(
    fixture,
    input.fixtureKey,
  );
  const namespaces = await createW6b2PackagedWorkspaceRuntimeNamespaces({
    business,
    fixture,
    fixtureKey: input.fixtureKey,
  });

  return Object.freeze({
    ...fixture,
    ...namespaces,
    fixtureKey: input.fixtureKey,
  });
}

export type { W6b2PackagedWorkspaceFixtureKey } from './w6b2PackagedWorkspaceBusinessFixture.js';
