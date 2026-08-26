import { describe, expect, it } from 'vitest';

import type { AcceptedBuildMetadata } from '../src/update/acceptedBuildMetadata.js';
import type { UpdateJournal, UpdateJournalState } from '../src/update/updateJournal.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceLifecycleState,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import {
  readW6b2BusinessAmounts,
  type W6b2PackagedWorkspaceFixtureKey,
} from './w6b2PackagedWorkspaceBusinessFixture.js';
import type { W6b2PackagedWorkspaceEvidence } from './w6b2PackagedWorkspaceEvidence.js';
import {
  assertW6b2PackagedFaultWorkspaceState,
  type W6b2PackagedFaultWorkspaceSnapshot,
} from './w6b2PackagedFaultWorkspaceProfile.js';
import type { W6b2PackagedFaultProfileOperation } from './w6b2PackagedWorkspaceProfileCommand.js';
import type { W6b2PackagedWorkspaceProfileState } from './w6b2PackagedWorkspaceProfileState.js';

const buildRevision = 'a'.repeat(40);
const fixtureKeys = ['A', 'B', 'C'] as const;
const workspaceIds = {
  A: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
  B: validateWorkspaceId('22222222-2222-4222-8222-222222222222'),
  C: validateWorkspaceId('33333333-3333-4333-8333-333333333333'),
} as const;

const operationExpectations = Object.freeze({
  verifyAcceptanceRecovery: {
    acceptedVersion: '0.2.8',
    cLifecycleState: 'recoveryRequired',
    changedDatabases: ['A'],
    journalState: 'accepted',
  },
  verifyActiveRollback: {
    acceptedVersion: '0.2.7',
    cLifecycleState: 'ready',
    changedDatabases: [],
    journalState: 'rolledBack',
  },
  verifyBinaryFailedSafe: {
    acceptedVersion: '0.2.7',
    cLifecycleState: 'ready',
    changedDatabases: [],
    journalState: 'failedSafe',
  },
  verifyPassiveRecovery: {
    acceptedVersion: '0.2.8',
    cLifecycleState: 'recoveryRequired',
    changedDatabases: ['A'],
    journalState: 'accepted',
  },
  verifyPreUpdateFailure: {
    acceptedVersion: '0.2.7',
    cLifecycleState: 'ready',
    changedDatabases: [],
    journalState: 'failed',
  },
} as const satisfies Readonly<
  Record<
    W6b2PackagedFaultProfileOperation,
    {
      readonly acceptedVersion: '0.2.7' | '0.2.8';
      readonly cLifecycleState: WorkspaceLifecycleState;
      readonly changedDatabases: readonly W6b2PackagedWorkspaceFixtureKey[];
      readonly journalState: UpdateJournalState;
    }
  >
>);

describe('W6B.2 packaged fault workspace profile', () => {
  it('accepts the exact terminal contract for all five fault scenarios', () => {
    for (const operation of Object.keys(
      operationExpectations,
    ) as W6b2PackagedFaultProfileOperation[]) {
      expect(() =>
        assertW6b2PackagedFaultWorkspaceState(
          createSnapshot(operation),
        ),
      ).not.toThrow();
    }
  });

  it('rejects changed business artifacts and an unexpected database transition', () => {
    const changedContent = createSnapshot('verifyActiveRollback');
    const evidenceA = changedContent.currentEvidence.get('A');
    if (evidenceA === undefined) throw new Error('test fixture invalid');
    changedContent.currentEvidence.set('A', {
      ...evidenceA,
      secretSentinel: fileEvidence('f', 10),
    });
    expect(() =>
      assertW6b2PackagedFaultWorkspaceState(changedContent),
    ).toThrow('W6B2_FAULT_PROFILE_CONTENT_INVALID');

    const changedDatabase = createSnapshot('verifyActiveRollback');
    const databaseEvidence = changedDatabase.currentEvidence.get('A');
    if (databaseEvidence === undefined) throw new Error('test fixture invalid');
    changedDatabase.currentEvidence.set('A', {
      ...databaseEvidence,
      database: fileEvidence('e', databaseEvidence.database.size + 1),
    });
    expect(() =>
      assertW6b2PackagedFaultWorkspaceState(changedDatabase),
    ).toThrow('W6B2_FAULT_PROFILE_DATABASE_INVALID');
  });

  it('rejects a mixed registry, accepted build or update journal', () => {
    const registryMismatch = createSnapshot('verifyAcceptanceRecovery');
    expect(() =>
      assertW6b2PackagedFaultWorkspaceState({
        ...registryMismatch,
        registry: {
          ...registryMismatch.registry,
          activeWorkspaceId: workspaceIds.B,
        },
      }),
    ).toThrow('W6B2_FAULT_PROFILE_REGISTRY_INVALID');

    const acceptedMismatch = createSnapshot('verifyAcceptanceRecovery');
    expect(() =>
      assertW6b2PackagedFaultWorkspaceState({
        ...acceptedMismatch,
        acceptedBuild: {
          ...requireAcceptedBuild(acceptedMismatch.acceptedBuild),
          appVersion: '0.2.7',
        },
      }),
    ).toThrow('W6B2_FAULT_PROFILE_ACCEPTED_BUILD_INVALID');

    const journalMismatch = createSnapshot('verifyBinaryFailedSafe');
    expect(() =>
      assertW6b2PackagedFaultWorkspaceState({
        ...journalMismatch,
        journal: {
          ...requireJournal(journalMismatch.journal),
          state: 'accepted',
        },
      }),
    ).toThrow('W6B2_FAULT_PROFILE_JOURNAL_INVALID');
  });
});

function createSnapshot(
  operation: W6b2PackagedFaultProfileOperation,
): W6b2PackagedFaultWorkspaceSnapshot & {
  currentEvidence: Map<
    W6b2PackagedWorkspaceFixtureKey,
    Readonly<W6b2PackagedWorkspaceEvidence>
  >;
  operation: W6b2PackagedFaultProfileOperation;
} {
  const expected = operationExpectations[operation];
  const changedDatabases: readonly W6b2PackagedWorkspaceFixtureKey[] =
    expected.changedDatabases;
  const state = createState();
  return {
    acceptedBuild: createAcceptedBuild(expected.acceptedVersion),
    currentEvidence: new Map(
      state.fixtures.map((fixture) => {
        const changed = changedDatabases.includes(fixture.fixtureKey);
        return [
          fixture.fixtureKey,
          {
            ...fixture.baseline,
            database: changed
              ? fileEvidence('e', fixture.baseline.database.size + 1)
              : fixture.baseline.database,
          },
        ];
      }),
    ),
    journal: createJournal(expected.journalState),
    operation,
    registry: createRegistry(state, expected.cLifecycleState),
    state,
  };
}

function createState(): Readonly<W6b2PackagedWorkspaceProfileState> {
  return Object.freeze({
    buildRevision,
    fixtures: Object.freeze(
      fixtureKeys.map((fixtureKey, index) => {
        const amounts = readW6b2BusinessAmounts(fixtureKey);
        const pdfHash = String(index + 4).repeat(64);
        return Object.freeze({
          baseline: evidence(String(index + 1), pdfHash),
          business: Object.freeze({
            companySettingsId: `company-${fixtureKey}`,
            customerId: `customer-${fixtureKey}`,
            customerNumber: `W6B2-${index + 1}`,
            documentId: `document-${fixtureKey}`,
            draftId: `draft-${fixtureKey}`,
            draftLineId: `draft-line-${fixtureKey}`,
            ...amounts,
            invoiceId: `invoice-${fixtureKey}`,
            invoiceLineId: `invoice-line-${fixtureKey}`,
            invoiceNumber: `62000${index + 1}`,
            pdfSha256: pdfHash,
            pdfSize: 100 + index,
          }),
          fixtureKey,
          profileId: String(index + 7).repeat(64),
          workspaceId: workspaceIds[fixtureKey],
        });
      }),
    ),
    formatVersion: 1,
    sourceVersion: '0.2.7',
    targetVersion: '0.2.8',
  });
}

function createRegistry(
  state: Readonly<W6b2PackagedWorkspaceProfileState>,
  cLifecycleState: WorkspaceLifecycleState,
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    activeWorkspaceId: workspaceIds.A,
    formatVersion: 1,
    workspaces: Object.freeze(
      state.fixtures.map((fixture, index) =>
        Object.freeze({
          createdAt: `2026-08-22T00:00:0${index}.000Z`,
          layoutVersion: 1,
          lifecycleState:
            fixture.fixtureKey === 'C' ? cLifecycleState : 'ready',
          lineageIdentity: Object.freeze({
            formatVersion: 1,
            profileId: fixture.profileId,
          }),
          workspaceId: fixture.workspaceId,
          workspaceLabel: `First-start workspace ${index + 1}`,
        }),
      ),
    ),
  });
}

function createAcceptedBuild(
  appVersion: '0.2.7' | '0.2.8',
): Readonly<AcceptedBuildMetadata> {
  return Object.freeze({
    acceptedAt: '2026-08-22T00:00:00.000Z',
    appVersion,
    buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
}

function createJournal(state: UpdateJournalState): Readonly<UpdateJournal> {
  const identity = Object.freeze({
    buildRevision,
    msiProductVersion: '0.2.7',
    packageSha256: 'b'.repeat(64),
    packageSize: 10_000,
  });
  return Object.freeze({
    binaryRollbackAttemptCount: state === 'rolledBack' ? 1 : 0,
    candidatePackageIdentity: Object.freeze({
      ...identity,
      msiProductVersion: '0.2.8',
      packageSha256: 'c'.repeat(64),
    }),
    correlationId: '11111111-1111-4111-8111-111111111111',
    createdAt: '2026-08-22T00:00:00.000Z',
    currentPackageIdentity: identity,
    currentVersion: '0.2.7',
    formatVersion: 1,
    handoffAttemptCount: state === 'failed' ? 0 : 1,
    releaseChannel: 'pilot',
    revision: 2,
    state,
    targetVersion: '0.2.8',
    updatedAt: '2026-08-22T00:01:00.000Z',
  });
}

function evidence(seed: string, pdfHash: string): W6b2PackagedWorkspaceEvidence {
  return Object.freeze({
    archiveConfig: fileEvidence(seed, 10),
    archiveJournal: fileEvidence(seed, 11),
    archiveSentinel: fileEvidence(seed, 12),
    businessRowsSha256: seed.repeat(64),
    database: fileEvidence(seed, 100),
    pdf: fileEvidence(pdfHash[0] ?? seed, 100),
    recoverySentinel: fileEvidence(seed, 13),
    secretSentinel: fileEvidence(seed, 14),
  });
}

function fileEvidence(seed: string, size: number) {
  return Object.freeze({ sha256: seed.repeat(64), size });
}

function requireAcceptedBuild(
  value: Readonly<AcceptedBuildMetadata> | undefined,
): Readonly<AcceptedBuildMetadata> {
  if (value === undefined) throw new Error('test fixture invalid');
  return value;
}

function requireJournal(
  value: Readonly<UpdateJournal> | undefined,
): Readonly<UpdateJournal> {
  if (value === undefined) throw new Error('test fixture invalid');
  return value;
}
