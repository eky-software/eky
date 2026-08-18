import { describe, expect, it } from 'vitest';

import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { EmptyWorkspaceCreationCoordinator } from './emptyWorkspaceCreationCoordinator.js';
import {
  createTestBootstrapResult,
  createTestRegistry,
  MemoryWorkspaceCreationJournal,
  MemoryWorkspaceCreationRootStore,
  MemoryWorkspaceRegistry,
  RecordingActiveWorkspaceLifecycle,
  RecordingEmptyWorkspaceBootstrap,
  RecordingWorkspaceMaintenanceLease,
  TEST_CREATED_AT,
  TEST_OPERATION_ID,
  TEST_SECOND_WORKSPACE_ID,
  TEST_USER_DATA_ROOT,
  TEST_WORKSPACE_ID,
} from './emptyWorkspaceCreationTestSupport.js';

interface CoordinatorFixture {
  readonly bootstrap: RecordingEmptyWorkspaceBootstrap;
  readonly coordinator: EmptyWorkspaceCreationCoordinator;
  readonly events: string[];
  readonly journal: MemoryWorkspaceCreationJournal;
  readonly lease: RecordingWorkspaceMaintenanceLease;
  readonly lifecycle: RecordingActiveWorkspaceLifecycle;
  readonly registry: MemoryWorkspaceRegistry;
  readonly rootStore: MemoryWorkspaceCreationRootStore;
}

function createFixture(input: {
  readonly registry?: Readonly<LocalWorkspaceRegistryV1>;
  readonly workspaceId?: WorkspaceId;
} = {}): CoordinatorFixture {
  const events: string[] = [];
  const journal = new MemoryWorkspaceCreationJournal(events);
  const registry = new MemoryWorkspaceRegistry(
    events,
    input.registry ?? createTestRegistry(),
  );
  const rootStore = new MemoryWorkspaceCreationRootStore(events);
  const lifecycle = new RecordingActiveWorkspaceLifecycle(events);
  const bootstrap = new RecordingEmptyWorkspaceBootstrap(events);
  const lease = new RecordingWorkspaceMaintenanceLease(events);
  return {
    events,
    journal,
    registry,
    rootStore,
    lifecycle,
    bootstrap,
    lease,
    coordinator: new EmptyWorkspaceCreationCoordinator({
      activeWorkspaceLifecycle: lifecycle,
      bootstrap,
      creationJournal: journal,
      generateOperationId: () => TEST_OPERATION_ID,
      generateWorkspaceId: () => input.workspaceId ?? TEST_WORKSPACE_ID,
      maintenanceLease: lease,
      now: () => new Date(TEST_CREATED_AT),
      registry,
      rootStore,
      userDataRoot: TEST_USER_DATA_ROOT,
    }),
  };
}

describe('empty workspace creation coordinator', () => {
  it('creates the first workspace through the exact durable publication order', async () => {
    const fixture = createFixture();

    await expect(fixture.coordinator.create('Oma yritys')).resolves.toEqual({
      workspaceId: TEST_WORKSPACE_ID,
      workspaceLabel: 'Oma yritys',
    });

    expect(fixture.events).toEqual([
      'lease.acquire.create',
      'journal.read',
      'registry.read',
      'lifecycle.quiesce',
      'lifecycle.stop',
      'journal.write.prepared',
      'root.createCandidate',
      'journal.write.candidateRootCreated',
      'bootstrap.run',
      'journal.write.bootstrapCompleted',
      'root.inspectCandidate',
      'journal.write.candidateValidated',
      'root.publishCandidate',
      'journal.write.rootPublished',
      'root.cleanupPublishedOperation',
      'registry.write',
      'journal.write.registryPublished',
      'lifecycle.restart',
      'journal.remove',
      'lease.release',
    ]);
    expect(fixture.registry.value).toMatchObject({
      activeWorkspaceId: TEST_WORKSPACE_ID,
      workspaces: [
        {
          workspaceId: TEST_WORKSPACE_ID,
          workspaceLabel: 'Oma yritys',
          lifecycleState: 'ready',
        },
      ],
    });
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.lease.held).toBe(false);
  });

  it('keeps the previous active workspace when a second workspace is published', async () => {
    const existing = createRegistryEntry(
      TEST_WORKSPACE_ID,
      'Nykyinen yritys',
      'b',
    );
    const fixture = createFixture({
      registry: createTestRegistry({
        activeWorkspaceId: TEST_WORKSPACE_ID,
        workspaces: [existing],
      }),
      workspaceId: TEST_SECOND_WORKSPACE_ID,
    });
    fixture.bootstrap.result = createTestBootstrapResult('c', '2');

    await fixture.coordinator.create('Uusi yritys');

    expect(fixture.registry.value?.activeWorkspaceId).toBe(TEST_WORKSPACE_ID);
    expect(fixture.registry.value?.workspaces).toHaveLength(2);
    expect(fixture.registry.value?.workspaces[1]).toMatchObject({
      workspaceId: TEST_SECOND_WORKSPACE_ID,
      workspaceLabel: 'Uusi yritys',
      lifecycleState: 'ready',
    });
  });

  it('allows duplicate labels while keeping workspace and lineage identities unique', async () => {
    const existing = createRegistryEntry(
      TEST_WORKSPACE_ID,
      'Sama nimi',
      'b',
    );
    const fixture = createFixture({
      registry: createTestRegistry({
        activeWorkspaceId: TEST_WORKSPACE_ID,
        workspaces: [existing],
      }),
      workspaceId: TEST_SECOND_WORKSPACE_ID,
    });
    fixture.bootstrap.result = createTestBootstrapResult('c', '2');

    await expect(fixture.coordinator.create('Sama nimi')).resolves.toEqual({
      workspaceId: TEST_SECOND_WORKSPACE_ID,
      workspaceLabel: 'Sama nimi',
    });
    expect(
      new Set(
        fixture.registry.value?.workspaces.map((entry) => entry.workspaceId),
      ).size,
    ).toBe(2);
    expect(
      new Set(
        fixture.registry.value?.workspaces.map(
          (entry) => entry.lineageIdentity.profileId,
        ),
      ).size,
    ).toBe(2);
  });

  it('rejects an invalid label before acquiring the maintenance lease', async () => {
    const fixture = createFixture();

    await expect(fixture.coordinator.create('   ')).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_INVALID',
      stage: 'inputValidation',
    });
    expect(fixture.events).toEqual([]);
  });

  it('fails closed when another maintenance operation owns the lease', async () => {
    const fixture = createFixture();
    fixture.lease.held = true;

    await expect(fixture.coordinator.create('Uusi yritys')).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_BUSY',
      stage: 'lease',
    });
    expect(fixture.events).toEqual(['lease.acquire.create']);
  });

  it('rejects a workspace id collision before creating a journal or candidate', async () => {
    const fixture = createFixture({
      registry: createTestRegistry({
        activeWorkspaceId: TEST_WORKSPACE_ID,
        workspaces: [
          createRegistryEntry(TEST_WORKSPACE_ID, 'Nykyinen yritys', 'b'),
        ],
      }),
    });

    await expect(fixture.coordinator.create('Uusi yritys')).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_CONFLICT',
      stage: 'identityGeneration',
    });
    expect(fixture.events).not.toContain('journal.write.prepared');
    expect(fixture.events).not.toContain('root.createCandidate');
    expect(fixture.events).toContain('lifecycle.restart');
    expect(fixture.lease.held).toBe(false);
  });

  it('removes a private candidate and journal when bootstrap validation fails', async () => {
    const fixture = createFixture();
    fixture.bootstrap.result = {
      ...createTestBootstrapResult(),
      migrationState: 'current-but-untrusted' as 'current',
    };

    await expect(fixture.coordinator.create('Uusi yritys')).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
      stage: 'bootstrap',
    });
    expect(fixture.rootStore.candidateExists).toBe(false);
    expect(fixture.rootStore.finalExists).toBe(false);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.events).toContain('root.discardCandidate');
    expect(fixture.events).toContain('lifecycle.restart');
  });

  it.each([
    ['migration failure', { migrationState: 'invalid' }],
    ['integrity failure', { databaseHealth: 'invalid' }],
    ['foreign key failure', { foreignKeyHealth: 'invalid' }],
    ['actor identity failure', { actorId: 'other-actor' }],
    ['company identity failure', { companyId: 'company-1' }],
    ['lineage failure', {
      lineageIdentity: { formatVersion: 1, profileId: 'invalid' },
    }],
    ['migration identity failure', { migrationChainIdentity: 'invalid' }],
    ['artifact root failure', { artifactRootHealth: 'invalid' }],
    ['open bootstrap handle', { handlesClosed: false }],
  ] as const)(
    'fails without publication on %s',
    async (_description, invalidResult) => {
      const fixture = createFixture();
      fixture.bootstrap.result = {
        ...createTestBootstrapResult(),
        ...invalidResult,
      } as typeof fixture.bootstrap.result;

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_CREATION_BOOTSTRAP_FAILED',
        stage: 'bootstrap',
      });
      expect(fixture.rootStore.candidateExists).toBe(false);
      expect(fixture.rootStore.finalExists).toBe(false);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current).toBeUndefined();
    },
  );

  it.each([
    'createBefore',
    'createAfter',
    'inspectCandidate',
    'publishBefore',
  ] as const)(
    'keeps registry state byte-identical when root storage fails at %s',
    async (failure) => {
      const fixture = createFixture();
      const registryBefore = JSON.stringify(fixture.registry.value);
      fixture.rootStore.failure = failure;

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toBeDefined();
      expect(JSON.stringify(fixture.registry.value)).toBe(registryBefore);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.rootStore.finalExists).toBe(false);
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.events).toContain('lifecycle.restart');
    },
  );

  it.each(['quiesce', 'stop'] as const)(
    'does not create durable state when active runtime %s fails',
    async (failure) => {
      const fixture = createFixture();
      fixture.lifecycle.failure = failure;

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_CREATION_LIFECYCLE_FAILED',
      });
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.rootStore.candidateExists).toBe(false);
      expect(fixture.registry.writes).toHaveLength(0);
    },
  );

  it.each(['prepared', 'candidateRootCreated'] as const)(
    'recovers safely when journal persistence fails before %s publication',
    async (state) => {
      const fixture = createFixture();
      fixture.journal.failBeforeState = state;

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_CREATION_JOURNAL_FAILED',
        stage: 'journal',
      });
      expect(fixture.rootStore.candidateExists).toBe(false);
      expect(fixture.rootStore.finalExists).toBe(false);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current).toBeUndefined();
      expect(fixture.events).toContain('lifecycle.restart');
    },
  );

  it.each(['prepared', 'candidateRootCreated'] as const)(
    'recovers safely when journal persistence fails after %s publication',
    async (state) => {
      const fixture = createFixture();
      fixture.journal.failAfterState = state;

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toMatchObject({
        code: 'WORKSPACE_CREATION_JOURNAL_FAILED',
        stage: 'journal',
      });
      expect(fixture.rootStore.candidateExists).toBe(false);
      expect(fixture.rootStore.finalExists).toBe(false);
      expect(fixture.registry.writes).toHaveLength(0);
      expect(fixture.journal.current).toBeUndefined();
    },
  );

  it('rejects a lineage collision without publishing a root or registry entry', async () => {
    const existing = createRegistryEntry(
      TEST_WORKSPACE_ID,
      'Nykyinen yritys',
      'a',
    );
    const fixture = createFixture({
      registry: createTestRegistry({
        activeWorkspaceId: TEST_WORKSPACE_ID,
        workspaces: [existing],
      }),
      workspaceId: TEST_SECOND_WORKSPACE_ID,
    });

    await expect(fixture.coordinator.create('Uusi yritys')).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_CONFLICT',
      stage: 'bootstrap',
    });
    expect(fixture.rootStore.finalExists).toBe(false);
    expect(fixture.registry.writes).toHaveLength(0);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('retains the recovery journal when publication may have completed', async () => {
    const fixture = createFixture();
    fixture.rootStore.failure = 'publishAfter';

    await expect(fixture.coordinator.create('Uusi yritys')).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'recovery',
    });
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.journal.current?.state).toBe('candidateValidated');
    expect(fixture.events).not.toContain('journal.discard');
    expect(fixture.events).toContain('lifecycle.restart');
    expect(fixture.lease.held).toBe(false);
  });

  it.each(['cleanupPublished', 'registryBefore', 'registryAfter'] as const)(
    'retains published evidence when publication fails at %s',
    async (failure) => {
      const fixture = createFixture();
      if (failure === 'cleanupPublished') {
        fixture.rootStore.failure = 'cleanupPublished';
      } else if (failure === 'registryBefore') {
        fixture.registry.failWriteBefore = true;
      } else {
        fixture.registry.failWriteAfter = true;
      }

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toBeDefined();
      expect(fixture.rootStore.finalExists).toBe(true);
      expect(fixture.journal.current?.state).toBe('rootPublished');
      expect(fixture.events).not.toContain('journal.discard');
      expect(fixture.events).toContain('lifecycle.restart');
    },
  );

  it.each(['rootPublished', 'registryPublished'] as const)(
    'retains a recoverable journal when the %s journal write fails after publication',
    async (state) => {
      const fixture = createFixture();
      fixture.journal.failAfterState = state;

      await expect(
        fixture.coordinator.create('Uusi yritys'),
      ).rejects.toBeDefined();
      expect(fixture.rootStore.finalExists).toBe(true);
      expect(fixture.journal.current?.state).toBe(state);
      expect(fixture.events).not.toContain('journal.discard');
    },
  );

  it('retains registry publication evidence when restarting the previous runtime fails', async () => {
    const fixture = createFixture();
    fixture.lifecycle.failure = 'restart';

    await expect(
      fixture.coordinator.create('Uusi yritys'),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_CREATION_RECOVERY_REQUIRED',
      stage: 'activeRuntimeRestart',
    });
    expect(fixture.registry.value?.workspaces).toHaveLength(1);
    expect(fixture.journal.current?.state).toBe('registryPublished');
    expect(fixture.rootStore.finalExists).toBe(true);
  });
});

function createRegistryEntry(
  workspaceId: WorkspaceId,
  workspaceLabel: string,
  profileCharacter: string,
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    workspaceId,
    workspaceLabel,
    lineageIdentity: Object.freeze({
      formatVersion: 1,
      profileId: profileCharacter.repeat(64),
    }),
    layoutVersion: 1,
    lifecycleState: 'ready',
    createdAt: TEST_CREATED_AT,
  });
}
