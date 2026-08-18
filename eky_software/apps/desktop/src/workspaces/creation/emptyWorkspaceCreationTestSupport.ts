import { resolve } from 'node:path';

import type {
  WorkspaceMaintenanceLease,
  WorkspaceMaintenanceLeaseHandle,
  WorkspaceMaintenancePurpose,
} from '../maintenance/workspaceMaintenanceLease.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { ActiveWorkspaceLifecyclePort } from '../runtime/activeWorkspaceLifecyclePort.js';
import type {
  EmptyWorkspaceBootstrapInput,
  EmptyWorkspaceBootstrapPort,
  EmptyWorkspaceBootstrapResult,
  PublishedWorkspaceValidationInput,
  PublishedWorkspaceValidationPort,
} from './emptyWorkspaceCreationPorts.js';
import { validateWorkspaceCreationOperationId } from './workspaceCreationOperationId.js';
import type { WorkspaceCreationPaths } from './workspaceCreationPaths.js';
import type {
  WorkspaceCreationRootPresence,
  WorkspaceCreationRootStore,
} from './workspaceCreationRootStore.js';
import type {
  WorkspaceCreationJournalStore,
  WorkspaceCreationJournalV1,
  WorkspaceCreationOperationId,
} from './workspaceCreationTypes.js';
import {
  assertWorkspaceCreationJournalTransition,
  validateWorkspaceCreationJournal,
} from './workspaceCreationJournalValidation.js';

export const TEST_OPERATION_ID = validateWorkspaceCreationOperationId(
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
);
export const TEST_WORKSPACE_ID = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
export const TEST_SECOND_WORKSPACE_ID = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
export const TEST_CREATED_AT = '2026-08-18T10:00:00.000Z';
export const TEST_USER_DATA_ROOT = resolve('Eky-test-profile');

export function createTestBootstrapResult(
  profileCharacter = 'a',
  companyCharacter = '1',
): Readonly<EmptyWorkspaceBootstrapResult> {
  return Object.freeze({
    actorId: 'local-owner',
    artifactRootHealth: 'ready',
    companyId: `local-company-${companyCharacter.repeat(32)}`,
    databaseHealth: 'healthy',
    foreignKeyHealth: 'healthy',
    handlesClosed: true,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId: profileCharacter.repeat(64),
    }),
    migrationChainIdentity: profileCharacter.repeat(64),
    migrationState: 'current',
  });
}

export function createTestRegistry(
  input: Partial<LocalWorkspaceRegistryV1> = {},
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId: input.activeWorkspaceId ?? null,
    workspaces: Object.freeze([...(input.workspaces ?? [])]),
  });
}

export class RecordingWorkspaceMaintenanceLease
  implements WorkspaceMaintenanceLease {
  held = false;

  constructor(private readonly events: string[]) {}

  async acquire(
    purpose: WorkspaceMaintenancePurpose,
  ): Promise<WorkspaceMaintenanceLeaseHandle> {
    this.events.push(`lease.acquire.${purpose}`);
    if (this.held) throw new Error('busy');
    this.held = true;
    let released = false;
    return {
      release: async () => {
        if (released) return;
        released = true;
        this.held = false;
        this.events.push('lease.release');
      },
    };
  }
}

export class MemoryWorkspaceCreationJournal
  implements WorkspaceCreationJournalStore {
  current: Readonly<WorkspaceCreationJournalV1> | undefined;
  readonly states: WorkspaceCreationJournalV1['state'][] = [];
  failBeforeState: WorkspaceCreationJournalV1['state'] | undefined;
  failAfterState: WorkspaceCreationJournalV1['state'] | undefined;
  failDiscard = false;
  failRemove = false;

  constructor(
    private readonly events: string[],
    initial?: Readonly<WorkspaceCreationJournalV1>,
  ) {
    this.current = initial;
  }

  async read(): Promise<Readonly<WorkspaceCreationJournalV1> | undefined> {
    this.events.push('journal.read');
    return this.current;
  }

  async write(value: unknown): Promise<void> {
    const next = validateWorkspaceCreationJournal(value);
    this.events.push(`journal.write.${next.state}`);
    if (this.failBeforeState === next.state) throw new Error('write');
    assertWorkspaceCreationJournalTransition(this.current, next);
    this.current = next;
    this.states.push(next.state);
    if (this.failAfterState === next.state) throw new Error('write');
  }

  async discardBeforePublication(
    operationId: WorkspaceCreationOperationId,
  ): Promise<void> {
    this.events.push('journal.discard');
    if (
      this.failDiscard ||
      this.current === undefined ||
      this.current.operationId !== operationId ||
      this.current.state === 'rootPublished' ||
      this.current.state === 'registryPublished'
    ) {
      throw new Error('discard');
    }
    this.current = undefined;
  }

  async remove(operationId: WorkspaceCreationOperationId): Promise<void> {
    this.events.push('journal.remove');
    if (
      this.failRemove ||
      this.current === undefined ||
      this.current.operationId !== operationId ||
      this.current.state !== 'registryPublished'
    ) {
      throw new Error('remove');
    }
    this.current = undefined;
  }
}

export class MemoryWorkspaceRegistry implements WorkspaceRegistryPort {
  failWriteBefore = false;
  failWriteAfter = false;
  readonly writes: Readonly<LocalWorkspaceRegistryV1>[] = [];

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
    if (this.failWriteBefore) throw new Error('registry');
    this.value = value as Readonly<LocalWorkspaceRegistryV1>;
    this.writes.push(this.value);
    if (this.failWriteAfter) throw new Error('registry');
  }
}

export type MemoryRootFailure =
  | 'createBefore'
  | 'createAfter'
  | 'inspectCandidate'
  | 'publishBefore'
  | 'publishAfter'
  | 'inspectPublished'
  | 'cleanupPublished'
  | 'discard';

export class MemoryWorkspaceCreationRootStore
  implements WorkspaceCreationRootStore {
  candidateExists = false;
  finalExists = false;
  failure: MemoryRootFailure | undefined;

  constructor(private readonly events: string[]) {}

  async createCandidate(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    this.events.push('root.createCandidate');
    if (this.failure === 'createBefore') throw new Error('create');
    this.candidateExists = true;
    if (this.failure === 'createAfter') throw new Error('create');
  }

  async inspectCandidate(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    this.events.push('root.inspectCandidate');
    if (this.failure === 'inspectCandidate' || !this.candidateExists) {
      throw new Error('inspect');
    }
  }

  async publishCandidate(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    this.events.push('root.publishCandidate');
    if (this.failure === 'publishBefore') throw new Error('publish');
    this.candidateExists = false;
    this.finalExists = true;
    if (this.failure === 'publishAfter') throw new Error('publish');
  }

  async inspectPublished(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    this.events.push('root.inspectPublished');
    if (this.failure === 'inspectPublished' || !this.finalExists) {
      throw new Error('published');
    }
  }

  async cleanupPublishedOperation(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    this.events.push('root.cleanupPublishedOperation');
    if (this.failure === 'cleanupPublished') throw new Error('cleanup');
  }

  async readPresence(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<Readonly<WorkspaceCreationRootPresence>> {
    this.events.push('root.readPresence');
    return Object.freeze({
      candidateExists: this.candidateExists,
      finalExists: this.finalExists,
    });
  }

  async discardCandidate(
    _paths: Readonly<WorkspaceCreationPaths>,
  ): Promise<void> {
    this.events.push('root.discardCandidate');
    if (this.failure === 'discard') throw new Error('discard');
    this.candidateExists = false;
  }
}

export type LifecycleFailure = 'quiesce' | 'stop' | 'restart';

export class RecordingActiveWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort {
  failure: LifecycleFailure | undefined;

  constructor(private readonly events: string[]) {}

  async quiesceWrites(
    _previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.events.push('lifecycle.quiesce');
    if (this.failure === 'quiesce') throw new Error('quiesce');
  }

  async stopAndProveHandlesClosed(
    _previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }> {
    this.events.push('lifecycle.stop');
    if (this.failure === 'stop') throw new Error('stop');
    return { handlesClosed: true };
  }

  async restartPreviousWorkspace(
    _previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.events.push('lifecycle.restart');
    if (this.failure === 'restart') throw new Error('restart');
  }
}

export class RecordingEmptyWorkspaceBootstrap
  implements EmptyWorkspaceBootstrapPort {
  fail = false;
  readonly inputs: Readonly<EmptyWorkspaceBootstrapInput>[] = [];

  constructor(
    private readonly events: string[],
    public result = createTestBootstrapResult(),
  ) {}

  async bootstrap(
    input: Readonly<EmptyWorkspaceBootstrapInput>,
  ): Promise<Readonly<EmptyWorkspaceBootstrapResult>> {
    this.events.push('bootstrap.run');
    this.inputs.push(input);
    if (this.fail) throw new Error('bootstrap');
    return this.result;
  }
}

export class RecordingPublishedWorkspaceValidation
  implements PublishedWorkspaceValidationPort {
  fail = false;
  readonly inputs: Readonly<PublishedWorkspaceValidationInput>[] = [];

  constructor(
    private readonly events: string[],
    public result = createTestBootstrapResult(),
  ) {}

  async validatePublished(
    input: Readonly<PublishedWorkspaceValidationInput>,
  ): Promise<Readonly<EmptyWorkspaceBootstrapResult>> {
    this.events.push('publishedValidation.run');
    this.inputs.push(input);
    if (this.fail) throw new Error('validation');
    return this.result;
  }
}

export function createTestJournal(input: {
  readonly state: WorkspaceCreationJournalV1['state'];
  readonly previousActiveWorkspaceId?: WorkspaceId | null;
  readonly workspaceId?: WorkspaceId;
  readonly profileCharacter?: string;
}): Readonly<WorkspaceCreationJournalV1> {
  const lineageRequired = [
    'bootstrapCompleted',
    'candidateValidated',
    'rootPublished',
    'registryPublished',
  ].includes(input.state);
  return Object.freeze({
    formatVersion: 1,
    operationId: TEST_OPERATION_ID,
    workspaceId: input.workspaceId ?? TEST_WORKSPACE_ID,
    workspaceLabel: 'Oma yritys',
    previousActiveWorkspaceId: input.previousActiveWorkspaceId ?? null,
    state: input.state,
    createdAt: TEST_CREATED_AT,
    lineageIdentity: lineageRequired
      ? Object.freeze({
          formatVersion: 1,
          profileId: (input.profileCharacter ?? 'a').repeat(64),
        })
      : null,
  });
}
