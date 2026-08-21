import { promises as fileSystem } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import type {
  LocalWorkspaceRegistryEntryV1,
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { WorkspaceMigrationInventoryCoordinator } from './workspaceMigrationInventoryCoordinator.js';
import {
  WorkspaceMigrationInventoryError,
  workspaceMigrationInventoryCancelledCode,
  workspaceMigrationInventoryFailedCode,
} from './workspaceMigrationInventoryError.js';
import type {
  PrivateWorkspaceMigrationInspectionRuntime,
  PrivateWorkspaceMigrationInspectionRuntimeFactory,
  WorkspaceMigrationInspectionInput,
  WorkspaceMigrationInspectionResult,
} from './workspaceMigrationInventoryTypes.js';

const firstWorkspaceId = validateWorkspaceId(
  '11111111-1111-4111-8111-111111111111',
);
const secondWorkspaceId = validateWorkspaceId(
  '22222222-2222-4222-8222-222222222222',
);
const recoveryWorkspaceId = validateWorkspaceId(
  '33333333-3333-4333-8333-333333333333',
);
const rootsToRemove: string[] = [];

afterEach(async () => {
  await Promise.all(
    rootsToRemove.splice(0).map((path) =>
      fileSystem.rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('WorkspaceMigrationInventoryCoordinator', () => {
  it('inspects only ready workspaces serially and returns a closed safe inventory', async () => {
    const registry = createRegistry();
    const userDataRoot = await createWorkspaceRoots(registry);
    let writeCount = 0;
    const registryPort: WorkspaceRegistryPort = {
      read: async () => registry,
      write: async () => {
        writeCount += 1;
      },
    };
    const runtimeFactory = new RecordingInspectionRuntimeFactory([
      result('current', 40, 0),
      result('compatiblePending', 38, 2),
    ]);
    const events: unknown[] = [];
    const coordinator = new WorkspaceMigrationInventoryCoordinator({
      createOperationId: () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      now: createClock(100, 112),
      observer: { record: (event) => events.push(event) },
      registry: registryPort,
      runtimeFactory,
      userDataRoot,
    });

    const inventory = await coordinator.inspect();

    expect(inventory).toEqual({
      activeWorkspaceId: firstWorkspaceId,
      entries: [
        {
          appliedMigrationCount: 40,
          isActive: true,
          pendingMigrationCount: 0,
          status: 'current',
          workspaceId: firstWorkspaceId,
        },
        {
          appliedMigrationCount: 38,
          isActive: false,
          pendingMigrationCount: 2,
          status: 'compatiblePending',
          workspaceId: secondWorkspaceId,
        },
      ],
    });
    expect(runtimeFactory.lifecycle).toEqual([
      `start:${firstWorkspaceId}`,
      `stop:${firstWorkspaceId}`,
      `inspect:${firstWorkspaceId}`,
      `start:${secondWorkspaceId}`,
      `stop:${secondWorkspaceId}`,
      `inspect:${secondWorkspaceId}`,
    ]);
    expect(runtimeFactory.maximumActiveRuntimeCount).toBe(1);
    expect(runtimeFactory.activeRuntimeCount).toBe(0);
    expect(runtimeFactory.inputs).toHaveLength(2);
    expect(runtimeFactory.inputs[0]?.expectedProfileId).toBe('a'.repeat(64));
    expect(runtimeFactory.inputs[1]?.expectedProfileId).toBe('b'.repeat(64));
    expect(runtimeFactory.inputs.some((input) =>
      input.publishedRoot.includes(recoveryWorkspaceId),
    )).toBe(false);
    expect(writeCount).toBe(0);
    expect(events).toEqual([
      {
        compatiblePendingCount: 1,
        currentCount: 1,
        durationMs: 12,
        inspectedWorkspaceCount: 2,
        invalidHistoryCount: 0,
        outcome: 'succeeded',
      },
    ]);
    const serialized = JSON.stringify(inventory);
    expect(serialized).not.toContain(userDataRoot);
    expect(serialized).not.toContain('profileId');
    expect(serialized).not.toContain('companyId');
    expect(serialized).not.toContain('runtimeSession');
    expect(Object.isFrozen(inventory)).toBe(true);
    expect(Object.isFrozen(inventory.entries)).toBe(true);
  });

  it('maps invalid history without exposing details and ignores observer failures', async () => {
    const registry = createRegistry({ includeSecond: false });
    const userDataRoot = await createWorkspaceRoots(registry);
    const coordinator = new WorkspaceMigrationInventoryCoordinator({
      observer: {
        record: () => {
          throw new Error('observer unavailable');
        },
      },
      registry: { read: async () => registry },
      runtimeFactory: new RecordingInspectionRuntimeFactory([
        result('invalidHistory', 0, 0),
      ]),
      userDataRoot,
    });

    await expect(coordinator.inspect()).resolves.toMatchObject({
      entries: [
        {
          appliedMigrationCount: 0,
          pendingMigrationCount: 0,
          status: 'invalidHistory',
        },
      ],
    });
  });

  it('fails closed on a malformed or missing registry before starting a utility', async () => {
    const runtimeFactory = new RecordingInspectionRuntimeFactory([]);
    const missing = new WorkspaceMigrationInventoryCoordinator({
      registry: { read: async () => undefined },
      runtimeFactory,
      userDataRoot: join(tmpdir(), 'missing-eky-workspaces'),
    });
    await expect(missing.inspect()).rejects.toMatchObject({
      code: workspaceMigrationInventoryFailedCode,
    });

    const malformed = {
      ...createRegistry({ includeSecond: false }),
      unexpected: true,
    } as unknown as LocalWorkspaceRegistryV1;
    const invalid = new WorkspaceMigrationInventoryCoordinator({
      registry: { read: async () => malformed },
      runtimeFactory,
      userDataRoot: join(tmpdir(), 'invalid-eky-workspaces'),
    });
    await expect(invalid.inspect()).rejects.toMatchObject({
      code: workspaceMigrationInventoryFailedCode,
    });
    expect(runtimeFactory.inputs).toEqual([]);
  });

  it('cancels an in-flight inspection without leaving a utility active', async () => {
    const registry = createRegistry({ includeSecond: false });
    const userDataRoot = await createWorkspaceRoots(registry);
    const controller = new AbortController();
    let activeRuntimeCount = 0;
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    const runtimeFactory: PrivateWorkspaceMigrationInspectionRuntimeFactory = {
      startMigrationInspection: async (input) => {
        activeRuntimeCount += 1;
        notifyStarted();
        return new Promise((_, reject) => {
          input.signal?.addEventListener(
            'abort',
            () => {
              activeRuntimeCount -= 1;
              reject(new Error('private cancellation'));
            },
            { once: true },
          );
        });
      },
    };
    const coordinator = new WorkspaceMigrationInventoryCoordinator({
      registry: { read: async () => registry },
      runtimeFactory,
      userDataRoot,
    });

    const inspection = coordinator.inspect(controller.signal);
    await started;
    controller.abort();

    await expect(inspection).rejects.toEqual(
      new WorkspaceMigrationInventoryError(
        workspaceMigrationInventoryCancelledCode,
      ),
    );
    expect(activeRuntimeCount).toBe(0);
  });

  it('fails closed when utility shutdown cannot prove all handles closed', async () => {
    const registry = createRegistry({ includeSecond: false });
    const userDataRoot = await createWorkspaceRoots(registry);
    const runtimeFactory: PrivateWorkspaceMigrationInspectionRuntimeFactory = {
      startMigrationInspection: async () => ({
        inspectStoppedMigrationInspection: async () =>
          result('current', 40, 0),
        stopAndProveHandlesClosed: async () => false,
      }),
    };
    const coordinator = new WorkspaceMigrationInventoryCoordinator({
      registry: { read: async () => registry },
      runtimeFactory,
      userDataRoot,
    });

    await expect(coordinator.inspect()).rejects.toMatchObject({
      code: workspaceMigrationInventoryFailedCode,
    });
  });
});

class RecordingInspectionRuntimeFactory
  implements PrivateWorkspaceMigrationInspectionRuntimeFactory
{
  activeRuntimeCount = 0;
  readonly inputs: WorkspaceMigrationInspectionInput[] = [];
  readonly lifecycle: string[] = [];
  maximumActiveRuntimeCount = 0;

  constructor(
    private readonly results: readonly Readonly<WorkspaceMigrationInspectionResult>[],
  ) {}

  async startMigrationInspection(
    input: Readonly<WorkspaceMigrationInspectionInput>,
  ): Promise<PrivateWorkspaceMigrationInspectionRuntime> {
    const resultValue = this.results[this.inputs.length];
    if (resultValue === undefined) throw new Error('test result missing');
    const workspaceId = workspaceIdFromPublishedRoot(input.publishedRoot);
    this.inputs.push({ ...input });
    this.activeRuntimeCount += 1;
    this.maximumActiveRuntimeCount = Math.max(
      this.maximumActiveRuntimeCount,
      this.activeRuntimeCount,
    );
    this.lifecycle.push(`start:${workspaceId}`);
    let stopped = false;
    return {
      inspectStoppedMigrationInspection: async () => {
        if (!stopped) throw new Error('runtime still active');
        this.lifecycle.push(`inspect:${workspaceId}`);
        return resultValue;
      },
      stopAndProveHandlesClosed: async () => {
        if (!stopped) {
          stopped = true;
          this.activeRuntimeCount -= 1;
          this.lifecycle.push(`stop:${workspaceId}`);
        }
        return true;
      },
    };
  }
}

function result(
  status: WorkspaceMigrationInspectionResult['status'],
  appliedMigrationCount: number,
  pendingMigrationCount: number,
): Readonly<WorkspaceMigrationInspectionResult> {
  return Object.freeze({
    appliedMigrationCount,
    pendingMigrationCount,
    status,
  });
}

function createRegistry(
  options: { readonly includeSecond?: boolean } = {},
): Readonly<LocalWorkspaceRegistryV1> {
  const workspaces: LocalWorkspaceRegistryEntryV1[] = [
    createEntry(firstWorkspaceId, 'a'.repeat(64), 'ready'),
  ];
  if (options.includeSecond !== false) {
    workspaces.push(createEntry(secondWorkspaceId, 'b'.repeat(64), 'ready'));
  }
  workspaces.push(
    createEntry(recoveryWorkspaceId, 'c'.repeat(64), 'recoveryRequired'),
  );
  return Object.freeze({
    activeWorkspaceId: firstWorkspaceId,
    formatVersion: 1,
    workspaces: Object.freeze(workspaces),
  });
}

function createEntry(
  workspaceId: WorkspaceId,
  profileId: string,
  lifecycleState: LocalWorkspaceRegistryEntryV1['lifecycleState'],
): Readonly<LocalWorkspaceRegistryEntryV1> {
  return Object.freeze({
    createdAt: '2026-08-21T10:00:00.000Z',
    layoutVersion: 1,
    lifecycleState,
    lineageIdentity: Object.freeze({ formatVersion: 1, profileId }),
    workspaceId,
    workspaceLabel: `Workspace ${workspaceId.slice(0, 4)}`,
  });
}

async function createWorkspaceRoots(
  registry: Readonly<LocalWorkspaceRegistryV1>,
): Promise<string> {
  const userDataRoot = await fileSystem.mkdtemp(
    join(tmpdir(), 'eky-migration-inventory-'),
  );
  rootsToRemove.push(userDataRoot);
  const workspacesRoot = join(userDataRoot, 'workspaces');
  await fileSystem.mkdir(workspacesRoot, { mode: 0o700 });
  for (const workspace of registry.workspaces) {
    await fileSystem.mkdir(join(workspacesRoot, workspace.workspaceId), {
      mode: 0o700,
    });
  }
  return userDataRoot;
}

function workspaceIdFromPublishedRoot(path: string): string {
  return path.replaceAll('\\', '/').split('/').at(-1) ?? '';
}

function createClock(...values: number[]): () => number {
  return () => {
    const value = values.shift();
    if (value === undefined) throw new Error('test clock exhausted');
    return value;
  };
}
