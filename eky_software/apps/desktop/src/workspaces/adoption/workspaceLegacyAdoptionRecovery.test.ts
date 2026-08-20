import { describe, expect, it } from 'vitest';

import { recoverWorkspaceLegacyAdoption } from './workspaceLegacyAdoptionRecovery.js';
import {
  createAdoptionJournal,
  createPublishedAdoptionRegistry,
  MemoryAdoptionJournal,
  MemoryAdoptionRegistry,
  MemoryAdoptionRootStore,
  asWorkspaceId,
} from './workspaceLegacyAdoptionTestSupport.js';

const userDataRoot =
  process.platform === 'win32' ? 'C:\\EkyTest' : '/tmp/eky-test';

describe('workspace legacy adoption recovery', () => {
  it('discards an unpublished candidate only when it matches the legacy source', async () => {
    const fixture = createFixture();
    fixture.root.candidateExists = true;

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .resolves.toBe('relaunchRequired');

    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).toContain('root.discardRecoveryCandidate');
    expect(fixture.events).not.toContain(
      'root.discardUnregisteredPublishedRoot',
    );
  });

  it('discards an unpublished final root only when it matches the legacy source', async () => {
    const fixture = createFixture();
    fixture.root.finalExists = true;

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .resolves.toBe('relaunchRequired');

    expect(fixture.journal.current).toBeUndefined();
    expect(fixture.events).toContain(
      'root.discardUnregisteredPublishedRoot',
    );
    expect(fixture.events).toContain('root.discardEmptyRecoveryOperation');
  });

  it('clears a journal with no remaining unpublished roots and is idempotent', async () => {
    const fixture = createFixture();

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .resolves.toBe('relaunchRequired');
    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .resolves.toBe('nothingToRecover');

    expect(fixture.events).toContain('root.discardEmptyRecoveryOperation');
  });

  it('finishes safely on retry if the journal clear failed after root cleanup', async () => {
    const fixture = createFixture();
    fixture.root.finalExists = true;
    fixture.journal.failNextClear = true;

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .rejects.toMatchObject({
        code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
      });
    expect(fixture.root.finalExists).toBe(false);
    expect(fixture.journal.current?.state).toBe('recoveryRequired');

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .resolves.toBe('relaunchRequired');
    expect(fixture.journal.current).toBeUndefined();
  });

  it('allows a registry that contains only other known workspaces', async () => {
    const events: string[] = [];
    const journal = new MemoryAdoptionJournal(
      events,
      createAdoptionJournal('recoveryRequired'),
    );
    const otherWorkspaceId = asWorkspaceId(
      '22222222-2222-4222-8222-222222222222',
    );
    const registry = new MemoryAdoptionRegistry(
      events,
      Object.freeze({
        formatVersion: 1 as const,
        activeWorkspaceId: otherWorkspaceId,
        workspaces: Object.freeze([
          Object.freeze({
            workspaceId: otherWorkspaceId,
            workspaceLabel: 'Other workspace',
            lineageIdentity: Object.freeze({
              formatVersion: 1 as const,
              profileId: 'b'.repeat(64),
            }),
            layoutVersion: 1 as const,
            lifecycleState: 'ready' as const,
            createdAt: '2026-08-19T09:00:00.000Z',
          }),
        ]),
      }),
    );
    const root = new MemoryAdoptionRootStore(events);

    await expect(
      recoverWorkspaceLegacyAdoption({
        journal,
        registry,
        rootStore: root,
        userDataRoot,
      }),
    ).resolves.toBe('relaunchRequired');

    expect(registry.value?.activeWorkspaceId).toBe(otherWorkspaceId);
    expect(registry.value?.workspaces).toHaveLength(1);
  });

  it.each([
    ['candidate and final roots both exist', (fixture: Fixture) => {
      fixture.root.candidateExists = true;
      fixture.root.finalExists = true;
    }],
    ['candidate differs from legacy', (fixture: Fixture) => {
      fixture.root.candidateExists = true;
      fixture.root.legacyMatchesCandidate = false;
    }],
    ['published root differs from legacy', (fixture: Fixture) => {
      fixture.root.finalExists = true;
      fixture.root.legacyMatchesFinal = false;
    }],
    ['recovery layout contains an unknown trace', (fixture: Fixture) => {
      fixture.root.recoveryLayoutValid = false;
    }],
    ['legacy source is no longer intact', (fixture: Fixture) => {
      fixture.root.sourceKind = 'fresh';
    }],
  ])('fails closed when %s', async (_name, arrange) => {
    const fixture = createFixture();
    arrange(fixture);

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .rejects.toMatchObject({
        code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
      });

    expect(fixture.journal.current?.state).toBe('recoveryRequired');
    expect(fixture.events).not.toContain('journal.clear');
  });

  it('fails closed when the workspace is already present in the registry', async () => {
    const events: string[] = [];
    const journal = new MemoryAdoptionJournal(
      events,
      createAdoptionJournal('recoveryRequired'),
    );
    const registry = new MemoryAdoptionRegistry(
      events,
      createPublishedAdoptionRegistry(),
    );
    const root = new MemoryAdoptionRootStore(events);

    await expect(
      recoverWorkspaceLegacyAdoption({
        journal,
        registry,
        rootStore: root,
        userDataRoot,
      }),
    ).rejects.toMatchObject({
      code: 'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
    });

    expect(events).not.toContain('root.assertRecoveryLayout');
    expect(events).not.toContain('journal.clear');
  });

  it('does not act on a journal that is not marked for recovery', async () => {
    const fixture = createFixture('rootPublished');

    await expect(recoverWorkspaceLegacyAdoption(fixture.options))
      .resolves.toBe('nothingToRecover');

    expect(fixture.events).toEqual(['journal.read']);
  });
});

interface Fixture {
  readonly events: string[];
  readonly journal: MemoryAdoptionJournal;
  readonly options: Parameters<typeof recoverWorkspaceLegacyAdoption>[0];
  readonly root: MemoryAdoptionRootStore;
}

function createFixture(
  state: Parameters<typeof createAdoptionJournal>[0] = 'recoveryRequired',
): Fixture {
  const events: string[] = [];
  const journal = new MemoryAdoptionJournal(
    events,
    createAdoptionJournal(state),
  );
  const registry = new MemoryAdoptionRegistry(events, undefined);
  const root = new MemoryAdoptionRootStore(events);
  return {
    events,
    journal,
    options: { journal, registry, rootStore: root, userDataRoot },
    root,
  };
}
