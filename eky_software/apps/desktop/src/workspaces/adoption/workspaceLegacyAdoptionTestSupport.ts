import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import {
  assertWorkspaceLegacyAdoptionTransition,
  type WorkspaceLegacyAdoptionJournalPort,
  type WorkspaceLegacyAdoptionJournalV1,
  type WorkspaceLegacyAdoptionSourceKind,
  validateWorkspaceLegacyAdoptionJournal,
} from './workspaceLegacyAdoptionJournal.js';
import type { WorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import type {
  WorkspaceLegacyAdoptionRootPort,
  WorkspaceLegacyAdoptionRootPresence,
} from './workspaceLegacyAdoptionRootStore.js';

export const TEST_ADOPTION_OPERATION_ID =
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const TEST_ADOPTION_WORKSPACE_ID = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
export const TEST_ADOPTION_CREATED_AT = '2026-08-19T10:00:00.000Z';

export function createAdoptionJournal(
  state: WorkspaceLegacyAdoptionJournalV1['state'],
  sourceKind: WorkspaceLegacyAdoptionSourceKind = 'legacy',
): Readonly<WorkspaceLegacyAdoptionJournalV1> {
  return Object.freeze({
    formatVersion: 1,
    operationId: TEST_ADOPTION_OPERATION_ID,
    workspaceId: TEST_ADOPTION_WORKSPACE_ID,
    sourceKind,
    state,
    createdAt: TEST_ADOPTION_CREATED_AT,
  });
}

export class MemoryAdoptionJournal implements WorkspaceLegacyAdoptionJournalPort {
  current: Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined;
  failNextClear = false;

  constructor(
    private readonly events: string[],
    initial?: Readonly<WorkspaceLegacyAdoptionJournalV1>,
  ) {
    this.current = initial;
  }

  async read(): Promise<Readonly<WorkspaceLegacyAdoptionJournalV1> | undefined> {
    this.events.push('journal.read');
    return this.current;
  }

  async write(value: unknown): Promise<void> {
    const next = validateWorkspaceLegacyAdoptionJournal(value);
    this.events.push(`journal.write.${next.state}`);
    assertWorkspaceLegacyAdoptionTransition(this.current, next);
    this.current = next;
  }

  async clear(operationId: string): Promise<void> {
    this.events.push('journal.clear');
    if (this.current?.operationId !== operationId) throw new Error('journal');
    if (this.failNextClear) {
      this.failNextClear = false;
      throw new Error('journal');
    }
    this.current = undefined;
  }
}

export class MemoryAdoptionRegistry implements WorkspaceRegistryPort {
  constructor(
    private readonly events: string[],
    public value: Readonly<LocalWorkspaceRegistryV1> | undefined,
  ) {}

  async read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined> {
    this.events.push('registry.read');
    return this.value;
  }

  async write(value: unknown): Promise<void> {
    this.events.push('registry.write');
    this.value = value as Readonly<LocalWorkspaceRegistryV1>;
  }
}

export class MemoryAdoptionRootStore implements WorkspaceLegacyAdoptionRootPort {
  candidateExists = false;
  finalExists = false;
  legacyMatchesCandidate = true;
  legacyMatchesFinal = true;
  recoveryLayoutValid = true;
  sourceKind: WorkspaceLegacyAdoptionSourceKind = 'legacy';
  untrackedRoots = false;

  constructor(private readonly events: string[]) {}

  async assertNoUntrackedWorkspaceRoots(): Promise<void> {
    this.events.push('root.assertClean');
    if (this.untrackedRoots) throw new Error('untracked');
  }

  async detectSourceKind(): Promise<WorkspaceLegacyAdoptionSourceKind> {
    this.events.push('root.detectSource');
    return this.sourceKind;
  }

  async prepareCandidate(): Promise<void> {
    this.events.push('root.prepareCandidate');
    if (this.candidateExists || this.finalExists) throw new Error('root');
    this.candidateExists = true;
  }

  async inspectCandidate(): Promise<void> {
    this.events.push('root.inspectCandidate');
    if (!this.candidateExists || this.finalExists) throw new Error('root');
  }

  async publishCandidate(): Promise<void> {
    this.events.push('root.publishCandidate');
    if (!this.candidateExists || this.finalExists) throw new Error('root');
    this.candidateExists = false;
    this.finalExists = true;
  }

  async inspectPublished(): Promise<void> {
    this.events.push('root.inspectPublished');
    if (this.candidateExists || !this.finalExists) throw new Error('root');
  }

  async readPresence(): Promise<Readonly<WorkspaceLegacyAdoptionRootPresence>> {
    this.events.push('root.readPresence');
    return Object.freeze({
      candidateExists: this.candidateExists,
      finalExists: this.finalExists,
    });
  }

  async discardCandidate(
    _paths: Readonly<WorkspaceLegacyAdoptionPaths>,
  ): Promise<void> {
    this.events.push('root.discardCandidate');
    this.candidateExists = false;
  }

  async assertRecoveryLayout(): Promise<void> {
    this.events.push('root.assertRecoveryLayout');
    if (!this.recoveryLayoutValid) throw new Error('layout');
  }

  async discardRecoveryCandidateMatchingLegacy(): Promise<void> {
    this.events.push('root.discardRecoveryCandidate');
    if (
      !this.candidateExists ||
      this.finalExists ||
      !this.legacyMatchesCandidate
    ) {
      throw new Error('candidate');
    }
    this.candidateExists = false;
  }

  async discardUnregisteredPublishedRootMatchingLegacy(): Promise<void> {
    this.events.push('root.discardUnregisteredPublishedRoot');
    if (
      this.candidateExists ||
      !this.finalExists ||
      !this.legacyMatchesFinal
    ) {
      throw new Error('published');
    }
    this.finalExists = false;
  }

  async discardEmptyRecoveryOperation(): Promise<void> {
    this.events.push('root.discardEmptyRecoveryOperation');
    if (this.candidateExists) throw new Error('operation');
  }
}

export function createPublishedAdoptionRegistry(
  profileId = 'a'.repeat(64),
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId: TEST_ADOPTION_WORKSPACE_ID,
    workspaces: Object.freeze([
      Object.freeze({
        workspaceId: TEST_ADOPTION_WORKSPACE_ID,
        workspaceLabel: 'Oma yritys',
        lineageIdentity: Object.freeze({ formatVersion: 1, profileId }),
        layoutVersion: 1,
        lifecycleState: 'ready',
        createdAt: TEST_ADOPTION_CREATED_AT,
      }),
    ]),
  });
}

export function asWorkspaceId(value: string): WorkspaceId {
  return validateWorkspaceId(value);
}
