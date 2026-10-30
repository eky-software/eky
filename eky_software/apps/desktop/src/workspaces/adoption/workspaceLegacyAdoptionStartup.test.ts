import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  resolveWorkspaceLegacyAdoptionStartup,
  type WorkspaceLegacyAdoptionAcceptancePorts,
} from './workspaceLegacyAdoptionStartup.js';
import { deriveWorkspaceLegacyAdoptionPaths } from './workspaceLegacyAdoptionPaths.js';
import {
  createAdoptionJournal,
  createPublishedAdoptionRegistry,
  MemoryAdoptionJournal,
  MemoryAdoptionRegistry,
  MemoryAdoptionRootStore,
  TEST_ADOPTION_CREATED_AT,
  TEST_ADOPTION_OPERATION_ID,
  TEST_ADOPTION_WORKSPACE_ID,
} from './workspaceLegacyAdoptionTestSupport.js';

describe('workspace legacy adoption startup', () => {
  it('rejects a changed source selection before publishing the initial journal', async () => {
    const fixture = createFixture();
    await expect(resolveWorkspaceLegacyAdoptionStartup({
      ...fixture.options, selectedSourceKind: 'fresh',
    })).rejects.toMatchObject({ code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED' });
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.registry.value).toBeUndefined();
    expect(fixture.events).not.toContain('root.prepareCandidate');
    expect(fixture.events).not.toContain('journal.write.prepared');
  });

  it('publishes and accepts a legacy workspace without mutating the source', async () => {
    const fixture = createFixture();

    const selection = await resolveWorkspaceLegacyAdoptionStartup(
      fixture.options,
    );

    expect(selection.workspaceId).toBe(TEST_ADOPTION_WORKSPACE_ID);
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.journal.current?.state).toBe('rootPublished');
    await selection.accept('a'.repeat(64), fixture.acceptancePorts);
    expect(fixture.registry.value).toEqual(createPublishedAdoptionRegistry());
    expect(fixture.events).toContain('root.discardCandidate');
    expect(fixture.journal.current).toBeUndefined();
  });

  it.each(['prepared', 'candidatePrepared', 'rootPublished'] as const)(
    'resumes safely after a crash around %s',
    async (state) => {
      const fixture = createFixture(createAdoptionJournal(state));
      fixture.rootStore.candidateExists = state === 'candidatePrepared';
      fixture.rootStore.finalExists = state === 'rootPublished';

      const selection = await resolveWorkspaceLegacyAdoptionStartup(
        fixture.options,
      );

      expect(fixture.rootStore.finalExists).toBe(true);
      await selection.accept('a'.repeat(64), fixture.acceptancePorts);
      expect(fixture.journal.current).toBeUndefined();
    },
  );

  it('repairs a crash after the registry write but before journal completion', async () => {
    const fixture = createFixture(
      createAdoptionJournal('rootPublished'),
      createPublishedAdoptionRegistry(),
    );
    fixture.rootStore.finalExists = true;

    const selection = await resolveWorkspaceLegacyAdoptionStartup(
      fixture.options,
    );

    expect(fixture.journal.current?.state).toBe('registryPublished');
    await selection.accept('a'.repeat(64), fixture.acceptancePorts);
    expect(fixture.journal.current).toBeUndefined();
  });

  it('marks recovery required when the accepted profile lineage changes', async () => {
    const fixture = createFixture(
      createAdoptionJournal('registryPublished'),
      createPublishedAdoptionRegistry('b'.repeat(64)),
    );
    fixture.rootStore.finalExists = true;

    const selection = await resolveWorkspaceLegacyAdoptionStartup(
      fixture.options,
    );

    fixture.expirePreparation();
    fixture.events.length = 0;
    await expect(selection.accept('a'.repeat(64), fixture.acceptancePorts)).rejects.toMatchObject({
      code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    });
    expect(fixture.journal.current?.state).toBe('recoveryRequired');
    expect(fixture.events).toEqual([
      'journal.read', 'registry.read', 'journal.read',
      'journal.write.recoveryRequired',
    ]);
    expect(fixture.acceptancePorts.publishBinding).not.toHaveBeenCalled();
    expect(fixture.acceptancePorts.cleanup.discardCandidate).not.toHaveBeenCalled();
  });

  it('accepts with only the live phase ports after preparation expires', async () => {
    const fixture = createFixture();
    const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
    fixture.expirePreparation();
    fixture.events.length = 0;

    await selection.accept('a'.repeat(64), fixture.acceptancePorts);

    expect(fixture.events).toEqual([
      'journal.read', 'registry.read', 'binding.publish', 'registry.write',
      'journal.read', 'journal.write.registryPublished',
      'root.discardCandidate', 'journal.clear',
    ]);
    expect(fixture.acceptancePorts.publishBinding).toHaveBeenCalledExactlyOnceWith('a'.repeat(64));
    expect(Object.isFrozen(fixture.acceptancePorts.cleanup)).toBe(true);
    expect(Reflect.ownKeys(fixture.acceptancePorts.cleanup)).toEqual(['discardCandidate']);
    expect(fixture.acceptancePorts.cleanup.discardCandidate).toHaveBeenCalledExactlyOnceWith(
      deriveWorkspaceLegacyAdoptionPaths(
        fixture.options.userDataRoot,
        TEST_ADOPTION_OPERATION_ID,
        TEST_ADOPTION_WORKSPACE_ID,
      ),
    );
    expect(fixture.registry.value).toEqual(createPublishedAdoptionRegistry());
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.expiredPreparationCalls).toEqual([]);
  });

  it('marks failure with only the recovery journal after preparation expires', async () => {
    const fixture = createFixture();
    const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
    fixture.expirePreparation();
    fixture.events.length = 0;
    const recoveryPorts = Object.freeze({ journal: fixture.journal });

    await expect(selection.recoverFromFailure(recoveryPorts)).resolves.toBe('notRecovered');

    expect(fixture.events).toEqual(['journal.read', 'journal.write.recoveryRequired']);
    expect(fixture.journal.current).toEqual(createAdoptionJournal('recoveryRequired'));
    expect(fixture.registry.value).toBeUndefined();
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.expiredPreparationCalls).toEqual([]);
  });

  it('preserves the binding failure without publishing registry or cleaning up', async () => {
    const fixture = createFixture();
    const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
    const failure = new Error('synthetic binding publication failure');
    fixture.acceptancePorts.publishBinding.mockRejectedValueOnce(failure);
    fixture.expirePreparation();
    fixture.events.length = 0;

    await expect(selection.accept('a'.repeat(64), fixture.acceptancePorts)).rejects.toBe(failure);

    expect(fixture.events).toEqual(['journal.read', 'registry.read']);
    expect(fixture.registry.value).toBeUndefined();
    expect(fixture.journal.current).toEqual(createAdoptionJournal('rootPublished'));
    expect(fixture.acceptancePorts.cleanup.discardCandidate).not.toHaveBeenCalled();
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.expiredPreparationCalls).toEqual([]);
  });

  it('accepts a matching ready registry without republishing it', async () => {
    const registry = createPublishedAdoptionRegistry();
    const fixture = createFixture(createAdoptionJournal('registryPublished'), registry);
    fixture.rootStore.finalExists = true;
    const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
    fixture.expirePreparation();
    fixture.events.length = 0;

    await selection.accept('a'.repeat(64), fixture.acceptancePorts);

    expect(fixture.events).toEqual([
      'journal.read', 'registry.read', 'binding.publish', 'journal.read',
      'root.discardCandidate', 'journal.clear',
    ]);
    expect(fixture.registry.value).toBe(registry);
    expect(fixture.expiredPreparationCalls).toEqual([]);
  });

  it('accepts fresh startup with an explicit no-op binding test double', async () => {
    const fixture = createFixture();
    fixture.rootStore.sourceKind = 'fresh';
    const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
    const publishBinding = vi.fn(async (_profileId: string) => {});
    fixture.expirePreparation();

    await selection.accept('a'.repeat(64), { ...fixture.acceptancePorts, publishBinding });

    expect(publishBinding).toHaveBeenCalledExactlyOnceWith('a'.repeat(64));
    expect(fixture.events).not.toContain('binding.publish');
    expect(fixture.registry.value).toEqual(createPublishedAdoptionRegistry());
    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.expiredPreparationCalls).toEqual([]);
  });

  it('validates the profile before reading or mutating acceptance ports', async () => {
    const fixture = createFixture();
    const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
    fixture.expirePreparation();
    fixture.events.length = 0;

    await expect(selection.accept('invalid', fixture.acceptancePorts)).rejects.toThrow();

    expect(fixture.events).toEqual([]);
    expect(fixture.acceptancePorts.publishBinding).not.toHaveBeenCalled();
    expect(fixture.acceptancePorts.cleanup.discardCandidate).not.toHaveBeenCalled();
  });

  it.each(['accept', 'recoverFromFailure'] as const)(
    'requires explicit ports for %s without falling back to preparation', async (operation) => {
      const fixture = createFixture();
      const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
      fixture.events.length = 0;

      if (operation === 'accept') {
        // Missing phase ports must also fail closed for untyped callers.
        // @ts-expect-error Acceptance ports are required.
        await expect(selection.accept('a'.repeat(64))).rejects.toThrow();
      } else {
        // @ts-expect-error Recovery ports are required.
        await expect(selection.recoverFromFailure()).rejects.toThrow();
      }

      expect(fixture.events).toEqual([]);
      expect(fixture.journal.current?.state).toBe('rootPublished');
    },
  );

  it.each(['workspaceId', 'sourceKind', 'createdAt', 'operationId', 'state', 'missing'] as const)(
    'rejects a changed %s before binding publication', async (field) => {
      const fixture = createFixture();
      const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
      fixture.journal.current = changedJournal(field);
      const changed = fixture.journal.current;
      fixture.expirePreparation();
      fixture.events.length = 0;

      await expect(selection.accept('a'.repeat(64), fixture.acceptancePorts)).rejects.toMatchObject({
        code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
      });

      expect(fixture.events).toEqual(['journal.read']);
      expect(fixture.journal.current).toBe(changed);
      expect(fixture.registry.value).toBeUndefined();
      expect(fixture.acceptancePorts.publishBinding).not.toHaveBeenCalled();
      expect(fixture.acceptancePorts.cleanup.discardCandidate).not.toHaveBeenCalled();
      expect(fixture.expiredPreparationCalls).toEqual([]);
    },
  );

  it.each(['workspaceId', 'sourceKind', 'createdAt', 'operationId', 'state', 'missing'] as const)(
    'does not mark a changed %s during recovery', async (field) => {
      const fixture = createFixture();
      const selection = await resolveWorkspaceLegacyAdoptionStartup(fixture.options);
      fixture.journal.current = changedJournal(field);
      const changed = fixture.journal.current;
      fixture.expirePreparation();
      fixture.events.length = 0;

      await expect(selection.recoverFromFailure({ journal: fixture.journal })).rejects.toMatchObject({
        code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
      });

      expect(fixture.events).toEqual(['journal.read']);
      expect(fixture.journal.current).toBe(changed);
      expect(fixture.expiredPreparationCalls).toEqual([]);
    },
  );

  it('rejects unexplained published roots before creating a journal', async () => {
    const fixture = createFixture();
    fixture.rootStore.untrackedRoots = true;

    await expect(resolveWorkspaceLegacyAdoptionStartup(fixture.options))
      .rejects.toThrow('untracked');
    expect(fixture.journal.current).toBeUndefined();
  });
});

function createFixture(
  initialJournal?: ReturnType<typeof createAdoptionJournal>,
  initialRegistry?: ReturnType<typeof createPublishedAdoptionRegistry>,
) {
  const events: string[] = [];
  const journal = new MemoryAdoptionJournal(events, initialJournal);
  const registry = new MemoryAdoptionRegistry(events, initialRegistry);
  const rootStore = new MemoryAdoptionRootStore(events);
  let preparationCurrent = true;
  const expiredPreparationCalls: string[] = [];
  function preparationPort<Port extends object>(port: Port): Port {
    return new Proxy(port, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]) => {
          if (!preparationCurrent) {
            expiredPreparationCalls.push(String(key));
            throw new Error('synthetic preparation phase expired');
          }
          return Reflect.apply(value, target, args);
        };
      },
    });
  }
  const acceptancePorts = {
    journal,
    registry,
    publishBinding: vi.fn(async (_profileId: string) => { events.push('binding.publish'); }),
    cleanup: Object.freeze({
      discardCandidate: vi.fn(rootStore.discardCandidate.bind(rootStore)),
    }),
  } satisfies WorkspaceLegacyAdoptionAcceptancePorts;
  return {
    acceptancePorts,
    events,
    expiredPreparationCalls,
    expirePreparation() { preparationCurrent = false; },
    journal,
    registry,
    rootStore,
    options: {
      generateOperationId: () => TEST_ADOPTION_OPERATION_ID,
      generateWorkspaceId: () => TEST_ADOPTION_WORKSPACE_ID,
      journal: preparationPort(journal),
      now: () => new Date(TEST_ADOPTION_CREATED_AT),
      registry: preparationPort(registry),
      rootStore: preparationPort(rootStore),
      userDataRoot: resolve('synthetic-user-data'),
    },
  };
}

function changedJournal(
  field: 'workspaceId' | 'sourceKind' | 'createdAt' | 'operationId' | 'state' | 'missing',
) {
  const journal = createAdoptionJournal('rootPublished');
  switch (field) {
    case 'workspaceId': return { ...journal, workspaceId: '22222222-2222-4222-8222-222222222222' as typeof journal.workspaceId };
    case 'sourceKind': return { ...journal, sourceKind: 'fresh' as const };
    case 'createdAt': return { ...journal, createdAt: '2026-08-20T10:00:00.000Z' };
    case 'operationId': return { ...journal, operationId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
    case 'state': return { ...journal, state: 'candidatePrepared' as const };
    case 'missing': return undefined;
  }
}
