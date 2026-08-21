import { describe, expect, it } from 'vitest';

import type { AcceptedBuildMetadata } from '../../update/acceptedBuildMetadata.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import {
  assertWorkspaceFirstStartMigrationJournalTransition,
  validateWorkspaceFirstStartMigrationJournal,
} from './workspaceFirstStartMigrationJournalCodec.js';
import { WorkspaceFirstStartMigrationTransitionError } from './workspaceFirstStartMigrationJournalError.js';
import type {
  WorkspaceFirstStartAcceptedBuildReader,
  WorkspaceFirstStartMigrationJournalPort,
  WorkspaceFirstStartMigrationJournalV1,
} from './workspaceFirstStartMigrationJournalTypes.js';
import type {
  WorkspaceFirstStartBuildIdentity,
  WorkspaceFirstStartMigrationPlan,
} from './workspaceFirstStartMigrationPlanTypes.js';
import {
  calculateWorkspaceRegistrySha256,
  markPassiveWorkspacesRecoveryRequired,
} from './workspaceFirstStartMigrationRegistryTransitions.js';
import { WorkspaceFirstStartMigrationTransitionCoordinator } from './workspaceFirstStartMigrationTransitionCoordinator.js';

const activeWorkspaceId = workspaceId('1');
const passiveWorkspaceId = workspaceId('2');
const sourceBuild = build('0.2.6', 'a');
const targetBuild = build('0.2.7', 'b');
const createdAt = '2026-08-21T00:00:00.000Z';
const operationId = '00000000-0000-4000-8000-000000000001';

describe('WorkspaceFirstStartMigrationTransitionCoordinator', () => {
  it('has no recovery side effects before the journal is durably written', async () => {
    const ports = createPorts({
      acceptedBuild: accepted(sourceBuild),
      registry: sourceRegistry(),
    });

    await expect(coordinator(ports).recover(sourceBuild)).resolves.toEqual({
      kind: 'noJournal',
    });
    expect(ports.events).toEqual([]);
    expect(ports.registry.writes).toHaveLength(0);
  });

  it('prepares the journal before any registry transition', async () => {
    const ports = createPorts({ registry: sourceRegistry() });
    const subject = coordinator(ports);

    const result = await subject.prepare({
      operationId,
      plan: requiredPlan(),
      sourceBuild,
      targetBuild,
      createdAt,
    });

    expect(result.state).toBe('prepared');
    expect(result.passiveRecoveryWorkspaceIds).toEqual([passiveWorkspaceId]);
    expect(ports.registry.writes).toHaveLength(0);
    expect(ports.events).toEqual(['journal.write']);
    expect(ports.journal.value).toEqual(result);
  });

  it('publishes the exact transitioned registry before advancing the journal', async () => {
    const foundation = createFoundation();
    const ports = createPorts({
      journal: foundation.journal,
      registry: foundation.source,
    });
    const subject = coordinator(ports);

    const result = await subject.transitionRegistry({
      operationId,
      sourceBuild,
      targetBuild,
      updatedAt: '2026-08-21T00:00:01.000Z',
    });

    expect(result.state).toBe('registryTransitioned');
    expect(ports.events).toEqual(['registry.write', 'journal.write']);
    expect(ports.registry.value).toEqual(foundation.transitioned);
    expect(ports.journal.value?.state).toBe('registryTransitioned');
  });

  it('finishes an interrupted registry publication idempotently', async () => {
    const foundation = createFoundation();
    const ports = createPorts({
      journal: foundation.journal,
      registry: foundation.transitioned,
    });

    await coordinator(ports).transitionRegistry({
      operationId,
      sourceBuild,
      targetBuild,
      updatedAt: '2026-08-21T00:00:01.000Z',
    });

    expect(ports.registry.writes).toHaveLength(0);
    expect(ports.events).toEqual(['journal.write']);
    expect(ports.journal.value?.state).toBe('registryTransitioned');
  });

  it('advances only the journal when there are no passive workspaces', async () => {
    const registry = activeOnlyRegistry();
    const ports = createPorts({ registry });
    const subject = coordinator(ports);
    await subject.prepare({
      operationId,
      plan: requiredActiveOnlyPlan(),
      sourceBuild,
      targetBuild,
      createdAt,
    });

    const result = await subject.transitionRegistry({
      operationId,
      sourceBuild,
      targetBuild,
      updatedAt: '2026-08-21T00:00:01.000Z',
    });

    expect(result.sourceRegistrySha256).toBe(
      result.transitionedRegistrySha256,
    );
    expect(ports.registry.writes).toHaveLength(0);
    expect(ports.events).toEqual(['journal.write', 'journal.write']);
  });

  it('restores the source registry after a crash between registry and journal writes', async () => {
    const foundation = createFoundation();
    const ports = createPorts({
      acceptedBuild: accepted(sourceBuild),
      journal: foundation.journal,
      registry: foundation.transitioned,
    });
    const subject = coordinator(ports);

    await expect(subject.recover(sourceBuild)).resolves.toEqual({
      kind: 'recoveredSource',
      operationId,
    });
    expect(ports.registry.value).toEqual(foundation.source);
    expect(ports.journal.value).toBeUndefined();
    await expect(subject.recover(sourceBuild)).resolves.toEqual({
      kind: 'noJournal',
    });
  });

  it('accepts the transitioned registry when the target build is already accepted', async () => {
    const foundation = createFoundation();
    const ports = createPorts({
      acceptedBuild: accepted(targetBuild),
      journal: foundation.journal,
      registry: foundation.transitioned,
    });

    await expect(coordinator(ports).recover(targetBuild)).resolves.toEqual({
      kind: 'acceptedTarget',
      operationId,
    });
    expect(ports.registry.writes).toHaveLength(0);
    expect(ports.journal.value).toBeUndefined();
  });

  it('does not accept a target build journal while the source build is running', async () => {
    const foundation = createFoundation({ state: 'registryTransitioned' });
    const ports = createPorts({
      acceptedBuild: accepted(targetBuild),
      journal: foundation.journal,
      registry: foundation.transitioned,
    });

    await expect(coordinator(ports).recover(sourceBuild)).resolves.toEqual({
      kind: 'recoveryRequired',
      operationId,
    });

    expect(ports.journal.value).toEqual(foundation.journal);
    expect(ports.events).toEqual([]);
  });

  it.each([
    {
      name: 'source accepted after journal transition',
      acceptedBuild: accepted(sourceBuild),
      runningBuild: sourceBuild,
      expectedKind: 'recoveredSource',
      expectedRegistry: 'source',
    },
    {
      name: 'target accepted after journal transition',
      acceptedBuild: accepted(targetBuild),
      runningBuild: targetBuild,
      expectedKind: 'acceptedTarget',
      expectedRegistry: 'transitioned',
    },
  ])('resolves $name', async ({
    acceptedBuild,
    runningBuild,
    expectedKind,
    expectedRegistry,
  }) => {
    const foundation = createFoundation({ state: 'registryTransitioned' });
    const ports = createPorts({
      acceptedBuild,
      journal: foundation.journal,
      registry: foundation.transitioned,
    });

    const result = await coordinator(ports).recover(runningBuild);

    expect(result.kind).toBe(expectedKind);
    expect(ports.registry.value).toEqual(
      expectedRegistry === 'source'
        ? foundation.source
        : foundation.transitioned,
    );
    expect(ports.journal.value).toBeUndefined();
  });

  it('leaves a prepared source state resumable without writes', async () => {
    const foundation = createFoundation();
    const ports = createPorts({
      acceptedBuild: accepted(sourceBuild),
      journal: foundation.journal,
      registry: foundation.source,
    });

    await expect(coordinator(ports).recover(targetBuild)).resolves.toEqual({
      kind: 'resumable',
      operationId,
    });
    expect(ports.events).toEqual([]);
  });

  it('fails closed on mixed builds or a changed registry without clearing evidence', async () => {
    const foundation = createFoundation({ state: 'registryTransitioned' });
    const changedRegistry: LocalWorkspaceRegistryV1 = {
      ...foundation.transitioned,
      workspaces: foundation.transitioned.workspaces.map((entry) =>
        entry.workspaceId === passiveWorkspaceId
          ? { ...entry, workspaceLabel: 'Unexpected rename' }
          : entry,
      ),
    };
    const ports = createPorts({
      acceptedBuild: accepted(targetBuild),
      journal: foundation.journal,
      registry: changedRegistry,
    });
    const subject = coordinator(ports);

    await expect(subject.recover(targetBuild)).resolves.toEqual({
      kind: 'recoveryRequired',
      operationId,
    });
    expect(ports.journal.value).toEqual(foundation.journal);
    expect(ports.events).toEqual([]);
    await expect(
      subject.recover(build('0.2.8', 'c')),
    ).resolves.toEqual({ kind: 'recoveryRequired', operationId });
  });

  it('cancels only a prepared operation whose exact source registry remains current', async () => {
    const foundation = createFoundation();
    const ports = createPorts({
      journal: foundation.journal,
      registry: foundation.source,
    });

    await coordinator(ports).cancelPrepared(operationId);

    expect(ports.journal.value).toBeUndefined();
    expect(ports.registry.writes).toHaveLength(0);
    expect(ports.events).toEqual(['journal.discardPrepared']);
  });

  it('completes only a transitioned operation whose target build is accepted', async () => {
    const foundation = createFoundation({ state: 'registryTransitioned' });
    const ports = createPorts({
      acceptedBuild: accepted(targetBuild),
      journal: foundation.journal,
      registry: foundation.transitioned,
    });

    await coordinator(ports).completeAcceptedTarget({
      operationId,
      sourceBuild,
      targetBuild,
    });

    expect(ports.journal.value).toBeUndefined();
    expect(ports.registry.writes).toHaveLength(0);
    expect(ports.events).toEqual(['journal.removeTransitioned']);
  });

  it.each([
    {
      name: 'the source build remains accepted',
      acceptedBuild: accepted(sourceBuild),
      registry: createFoundation({ state: 'registryTransitioned' })
        .transitioned,
    },
    {
      name: 'the transitioned registry has changed',
      acceptedBuild: accepted(targetBuild),
      registry: {
        ...createFoundation({ state: 'registryTransitioned' }).transitioned,
        workspaces: createFoundation({ state: 'registryTransitioned' })
          .transitioned.workspaces.map((workspace) =>
            workspace.workspaceId === passiveWorkspaceId
              ? { ...workspace, workspaceLabel: 'Changed workspace' }
              : workspace,
          ),
      },
    },
  ])('keeps recovery evidence when $name', async ({
    acceptedBuild,
    registry,
  }) => {
    const foundation = createFoundation({ state: 'registryTransitioned' });
    const ports = createPorts({
      acceptedBuild,
      journal: foundation.journal,
      registry,
    });

    await expect(
      coordinator(ports).completeAcceptedTarget({
        operationId,
        sourceBuild,
        targetBuild,
      }),
    ).rejects.toMatchObject({ failure: 'recoveryRequired' });

    expect(ports.journal.value).toEqual(foundation.journal);
    expect(ports.events).toEqual([]);
  });

  it('rejects a not-required plan and mismatched transition builds', async () => {
    const ports = createPorts({ registry: sourceRegistry() });
    const subject = coordinator(ports);
    const notRequired = Object.freeze({
      activeWorkspace: null,
      kind: 'notRequired' as const,
      passiveRecoveryWorkspaceIds: Object.freeze([]) as readonly [],
    });

    await expect(
      subject.prepare({
        operationId,
        plan: notRequired,
        sourceBuild,
        targetBuild,
        createdAt,
      }),
    ).rejects.toBeInstanceOf(WorkspaceFirstStartMigrationTransitionError);

    const foundation = createFoundation();
    const transitionPorts = createPorts({
      journal: foundation.journal,
      registry: foundation.source,
    });
    await expect(
      coordinator(transitionPorts).transitionRegistry({
        operationId,
        sourceBuild,
        targetBuild: build('0.2.8', 'c'),
        updatedAt: '2026-08-21T00:00:01.000Z',
      }),
    ).rejects.toBeInstanceOf(WorkspaceFirstStartMigrationTransitionError);
    expect(transitionPorts.events).toEqual([]);
  });
});

interface TestPorts {
  readonly events: string[];
  readonly journal: MemoryJournal;
  readonly registry: MemoryRegistry;
  readonly acceptedBuild: MemoryAcceptedBuild;
}

class MemoryJournal implements WorkspaceFirstStartMigrationJournalPort {
  constructor(
    readonly events: string[],
    public value?: Readonly<WorkspaceFirstStartMigrationJournalV1>,
  ) {}

  async read() {
    return this.value;
  }

  async write(value: unknown) {
    const next = validateWorkspaceFirstStartMigrationJournal(value);
    assertWorkspaceFirstStartMigrationJournalTransition(this.value, next);
    this.value = next;
    this.events.push('journal.write');
  }

  async discardPrepared(id: string) {
    if (this.value?.state !== 'prepared' || this.value.operationId !== id) {
      throw new Error('INVALID_TEST_JOURNAL_DISCARD');
    }
    this.value = undefined;
    this.events.push('journal.discardPrepared');
  }

  async removeTransitioned(id: string) {
    if (
      this.value?.state !== 'registryTransitioned' ||
      this.value.operationId !== id
    ) {
      throw new Error('INVALID_TEST_JOURNAL_REMOVE');
    }
    this.value = undefined;
    this.events.push('journal.removeTransitioned');
  }
}

class MemoryRegistry implements Pick<WorkspaceRegistryPort, 'read' | 'write'> {
  readonly writes: Readonly<LocalWorkspaceRegistryV1>[] = [];

  constructor(
    readonly events: string[],
    public value: Readonly<LocalWorkspaceRegistryV1> | undefined,
  ) {}

  async read() {
    return this.value;
  }

  async write(value: unknown) {
    this.value = value as Readonly<LocalWorkspaceRegistryV1>;
    this.writes.push(this.value);
    this.events.push('registry.write');
  }
}

class MemoryAcceptedBuild implements WorkspaceFirstStartAcceptedBuildReader {
  constructor(public value?: Readonly<AcceptedBuildMetadata>) {}

  async read() {
    return this.value;
  }
}

function createPorts(options: {
  acceptedBuild?: Readonly<AcceptedBuildMetadata>;
  journal?: Readonly<WorkspaceFirstStartMigrationJournalV1>;
  registry?: Readonly<LocalWorkspaceRegistryV1>;
}): TestPorts {
  const events: string[] = [];
  return {
    events,
    journal: new MemoryJournal(events, options.journal),
    registry: new MemoryRegistry(events, options.registry),
    acceptedBuild: new MemoryAcceptedBuild(options.acceptedBuild),
  };
}

function coordinator(ports: TestPorts) {
  return new WorkspaceFirstStartMigrationTransitionCoordinator({
    acceptedBuild: ports.acceptedBuild,
    journal: ports.journal,
    registry: ports.registry,
  });
}

function createFoundation(
  options: { state?: 'prepared' | 'registryTransitioned' } = {},
) {
  const source = sourceRegistry();
  const transitioned = markPassiveWorkspacesRecoveryRequired(
    source,
    activeWorkspaceId,
    [passiveWorkspaceId],
  );
  const journal = validateWorkspaceFirstStartMigrationJournal({
    formatVersion: 1,
    operationId,
    state: options.state ?? 'prepared',
    sourceBuild,
    targetBuild,
    activeWorkspaceId,
    passiveRecoveryWorkspaceIds: [passiveWorkspaceId],
    sourceRegistrySha256: calculateWorkspaceRegistrySha256(source),
    transitionedRegistrySha256:
      calculateWorkspaceRegistrySha256(transitioned),
    createdAt,
    updatedAt:
      options.state === 'registryTransitioned'
        ? '2026-08-21T00:00:01.000Z'
        : createdAt,
  });
  return { source, transitioned, journal };
}

function requiredPlan(): Readonly<WorkspaceFirstStartMigrationPlan> {
  return Object.freeze({
    kind: 'required',
    activeWorkspace: Object.freeze({
      appliedMigrationCount: 38,
      pendingMigrationCount: 2,
      status: 'compatiblePending',
      workspaceId: activeWorkspaceId,
    }),
    passiveRecoveryWorkspaceIds: Object.freeze([passiveWorkspaceId]),
  });
}

function requiredActiveOnlyPlan(): Readonly<WorkspaceFirstStartMigrationPlan> {
  return Object.freeze({
    kind: 'required',
    activeWorkspace: Object.freeze({
      appliedMigrationCount: 38,
      pendingMigrationCount: 2,
      status: 'compatiblePending',
      workspaceId: activeWorkspaceId,
    }),
    passiveRecoveryWorkspaceIds: Object.freeze([]),
  });
}

function activeOnlyRegistry(): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId,
    workspaces: Object.freeze([entry(activeWorkspaceId)]),
  });
}

function sourceRegistry(): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    formatVersion: 1,
    activeWorkspaceId,
    workspaces: Object.freeze([
      entry(activeWorkspaceId),
      entry(passiveWorkspaceId),
    ]),
  });
}

function entry(
  id: WorkspaceId,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    workspaceId: id,
    workspaceLabel: `Workspace ${id.slice(0, 1)}`,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId: id.slice(0, 1).repeat(64),
    }),
    layoutVersion: 1,
    lifecycleState: 'ready',
    createdAt,
  });
}

function build(
  appVersion: string,
  revisionCharacter: string,
): Readonly<WorkspaceFirstStartBuildIdentity> {
  return Object.freeze({
    appVersion,
    buildRevision: revisionCharacter.repeat(40),
  });
}

function accepted(
  identity: Readonly<WorkspaceFirstStartBuildIdentity>,
): Readonly<AcceptedBuildMetadata> {
  return Object.freeze({
    acceptedAt: createdAt,
    appVersion: identity.appVersion,
    buildRevision: identity.buildRevision,
    formatVersion: 1,
    releaseChannel: 'pilot',
  });
}

function workspaceId(value: string): WorkspaceId {
  return validateWorkspaceId(
    `${value.repeat(8)}-${value.repeat(4)}-4${value.repeat(3)}-8${
      value.repeat(3)
    }-${value.repeat(12)}`,
  );
}
