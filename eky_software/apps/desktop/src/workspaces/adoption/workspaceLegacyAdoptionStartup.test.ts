import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { resolveWorkspaceLegacyAdoptionStartup } from './workspaceLegacyAdoptionStartup.js';
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
  it('publishes and accepts a legacy workspace without mutating the source', async () => {
    const fixture = createFixture();

    const selection = await resolveWorkspaceLegacyAdoptionStartup(
      fixture.options,
    );

    expect(selection.workspaceId).toBe(TEST_ADOPTION_WORKSPACE_ID);
    expect(fixture.rootStore.finalExists).toBe(true);
    expect(fixture.journal.current?.state).toBe('rootPublished');
    await selection.accept('a'.repeat(64));
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
      await selection.accept('a'.repeat(64));
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
    await selection.accept('a'.repeat(64));
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

    await expect(selection.accept('a'.repeat(64))).rejects.toMatchObject({
      code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    });
    expect(fixture.journal.current?.state).toBe('recoveryRequired');
  });

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
  return {
    events,
    journal,
    registry,
    rootStore,
    options: {
      generateOperationId: () => TEST_ADOPTION_OPERATION_ID,
      generateWorkspaceId: () => TEST_ADOPTION_WORKSPACE_ID,
      journal,
      now: () => new Date(TEST_ADOPTION_CREATED_AT),
      registry,
      rootStore,
      userDataRoot: resolve('synthetic-user-data'),
    },
  };
}
