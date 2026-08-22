import { describe, expect, it, vi } from 'vitest';

import type { LocalWorkspaceRegistryV1 } from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import type { WorkspaceSwitchJournalV1 } from '../switch/workspaceSwitchJournal.js';
import { WorkspaceActivationMigrationError } from './workspaceActivationMigrationError.js';
import { WorkspaceActivationMigrationGuard } from './workspaceActivationMigrationGuard.js';

const operationId = '10000000-0000-4000-8000-000000000001';
const sourceWorkspaceId = validateWorkspaceId(
  '10000000-0000-4000-8000-000000000002',
);
const targetWorkspaceId = validateWorkspaceId(
  '10000000-0000-4000-8000-000000000003',
);
const sourceProfileId = '1'.repeat(64);
const targetProfileId = '2'.repeat(64);

describe('WorkspaceActivationMigrationGuard', () => {
  it('proves and reproves one exact targetSelected switch transaction', async () => {
    const fixture = createFixture();

    const proof = await fixture.guard.prove(createInput());
    await fixture.guard.reprove(proof);

    expect(proof).toMatchObject({
      operationId,
      profileId: targetProfileId,
      sourceWorkspaceId,
      targetWorkspaceId,
    });
    expect(fixture.readRegistry).toHaveBeenCalledTimes(2);
    expect(fixture.readJournal).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['missing journal', null, createRegistry()],
    [
      'wrong journal state',
      createJournal({ state: 'prepared' }),
      createRegistry(),
    ],
    [
      'wrong active workspace',
      createJournal(),
      createRegistry({ activeWorkspaceId: sourceWorkspaceId }),
    ],
    [
      'recovery target',
      createJournal(),
      createRegistry({ targetLifecycleState: 'recoveryRequired' }),
    ],
  ])('rejects %s as recovery-required', async (_name, journal, registry) => {
    const fixture = createFixture({ journal, registry });

    await expect(fixture.guard.prove(createInput())).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
  });

  it('rejects any registry or journal change during reproof', async () => {
    const fixture = createFixture();
    const proof = await fixture.guard.prove(createInput());
    fixture.registry = createRegistry({ targetLabel: 'Changed' });

    await expect(fixture.guard.reprove(proof)).rejects.toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_RECOVERY_REQUIRED',
    });
  });

  it('maps storage failures without exposing their raw details', async () => {
    const fixture = createFixture();
    fixture.readRegistry.mockRejectedValueOnce(
      new Error('D:\\private\\registry.json'),
    );

    const failure = await fixture.guard.prove(createInput()).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(WorkspaceActivationMigrationError);
    expect(failure).toMatchObject({
      code: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
      message: 'WORKSPACE_ACTIVATION_MIGRATION_FAILED',
    });
    expect(String(failure)).not.toContain('private');
  });
});

function createFixture(options?: {
  journal?: Readonly<WorkspaceSwitchJournalV1> | null;
  registry?: Readonly<LocalWorkspaceRegistryV1>;
}) {
  let registry = options?.registry ?? createRegistry();
  let journal: Readonly<WorkspaceSwitchJournalV1> | undefined =
    options !== undefined && 'journal' in options
      ? options.journal ?? undefined
      : createJournal();
  const readRegistry = vi.fn(async () => registry);
  const readJournal = vi.fn(async () => journal);
  return {
    guard: new WorkspaceActivationMigrationGuard(
      { read: readRegistry },
      { read: readJournal },
    ),
    get journal() {
      return journal;
    },
    set journal(value: Readonly<WorkspaceSwitchJournalV1> | undefined) {
      journal = value;
    },
    readJournal,
    readRegistry,
    get registry() {
      return registry;
    },
    set registry(value: Readonly<LocalWorkspaceRegistryV1>) {
      registry = value;
    },
  };
}

function createInput() {
  return {
    expectedProfileId: targetProfileId,
    operationId,
    sourceWorkspaceId,
    targetWorkspaceId,
  } as const;
}

function createJournal(
  overrides: Partial<WorkspaceSwitchJournalV1> = {},
): Readonly<WorkspaceSwitchJournalV1> {
  return Object.freeze({
    createdAt: '2026-08-22T00:00:00.000Z',
    formatVersion: 1,
    operationId,
    sourceWorkspaceId,
    state: 'targetSelected',
    targetWorkspaceId,
    ...overrides,
  });
}

function createRegistry(
  overrides: {
    activeWorkspaceId?: typeof sourceWorkspaceId | typeof targetWorkspaceId;
    targetLabel?: string;
    targetLifecycleState?: 'ready' | 'recoveryRequired';
  } = {},
): Readonly<LocalWorkspaceRegistryV1> {
  return Object.freeze({
    activeWorkspaceId:
      overrides.activeWorkspaceId ?? targetWorkspaceId,
    formatVersion: 1,
    workspaces: [
      Object.freeze({
        createdAt: '2026-08-20T00:00:00.000Z',
        layoutVersion: 1,
        lifecycleState: 'ready',
        lineageIdentity: Object.freeze({
          formatVersion: 1,
          profileId: sourceProfileId,
        }),
        workspaceId: sourceWorkspaceId,
        workspaceLabel: 'Source',
      }),
      Object.freeze({
        createdAt: '2026-08-21T00:00:00.000Z',
        layoutVersion: 1,
        lifecycleState:
          overrides.targetLifecycleState ?? 'ready',
        lineageIdentity: Object.freeze({
          formatVersion: 1,
          profileId: targetProfileId,
        }),
        workspaceId: targetWorkspaceId,
        workspaceLabel: overrides.targetLabel ?? 'Target',
      }),
    ],
  });
}
