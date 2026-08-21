import { randomUUID } from 'node:crypto';

import { createDesktopProfilePaths } from '../../runtime/desktopProfilePaths.js';
import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';
import {
  WorkspaceMigrationInventoryError,
  workspaceMigrationInventoryCancelledCode,
  workspaceMigrationInventoryFailedCode,
} from './workspaceMigrationInventoryError.js';
import type {
  PrivateWorkspaceMigrationInspectionRuntime,
  PrivateWorkspaceMigrationInspectionRuntimeFactory,
  WorkspaceMigrationInventory,
  WorkspaceMigrationInventoryEntry,
  WorkspaceMigrationInventoryEvent,
  WorkspaceMigrationInventoryObserver,
  WorkspaceMigrationInspectionResult,
} from './workspaceMigrationInventoryTypes.js';

export interface WorkspaceMigrationInventoryCoordinatorOptions {
  readonly createOperationId?: () => string;
  readonly now?: () => number;
  readonly observer?: WorkspaceMigrationInventoryObserver;
  readonly registry: Pick<WorkspaceRegistryPort, 'read'>;
  readonly runtimeFactory: PrivateWorkspaceMigrationInspectionRuntimeFactory;
  readonly userDataRoot: string;
}

export class WorkspaceMigrationInventoryCoordinator {
  private readonly createOperationId: () => string;
  private readonly now: () => number;

  constructor(
    private readonly options: Readonly<
      WorkspaceMigrationInventoryCoordinatorOptions
    >,
  ) {
    this.createOperationId = options.createOperationId ?? randomUUID;
    this.now = options.now ?? Date.now;
  }

  async inspect(
    signal?: AbortSignal,
  ): Promise<Readonly<WorkspaceMigrationInventory>> {
    const startedAt = this.now();
    const entries: WorkspaceMigrationInventoryEntry[] = [];
    let outcome: WorkspaceMigrationInventoryEvent['outcome'] = 'failed';
    try {
      throwIfCancelled(signal);
      const storedRegistry = await this.options.registry.read();
      if (storedRegistry === undefined) {
        throw new Error(workspaceMigrationInventoryFailedCode);
      }
      const registry = validateWorkspaceRegistry(storedRegistry);
      for (const workspace of registry.workspaces) {
        if (workspace.lifecycleState !== 'ready') continue;
        throwIfCancelled(signal);
        const roots = deriveWorkspaceRoot(
          this.options.userDataRoot,
          workspace.workspaceId,
          workspace.layoutVersion,
        );
        await inspectWorkspaceRoot(roots);
        const profile = createDesktopProfilePaths(roots.workspaceRoot);
        const result = await inspectOneWorkspace(
          this.options.runtimeFactory,
          {
            databaseFilePath: profile.databaseFilePath,
            expectedProfileId: workspace.lineageIdentity.profileId,
            operationId: this.createOperationId(),
            publishedRoot: roots.workspaceRoot,
            ...(signal === undefined ? {} : { signal }),
          },
        );
        throwIfCancelled(signal);
        entries.push(
          Object.freeze({
            appliedMigrationCount: result.appliedMigrationCount,
            isActive: workspace.workspaceId === registry.activeWorkspaceId,
            pendingMigrationCount: result.pendingMigrationCount,
            status: result.status,
            workspaceId: workspace.workspaceId,
          }),
        );
      }
      outcome = 'succeeded';
      return Object.freeze({
        activeWorkspaceId: registry.activeWorkspaceId,
        entries: Object.freeze(entries),
      });
    } catch (error) {
      if (signal?.aborted === true) {
        throw new WorkspaceMigrationInventoryError(
          workspaceMigrationInventoryCancelledCode,
        );
      }
      if (error instanceof WorkspaceMigrationInventoryError) throw error;
      throw new WorkspaceMigrationInventoryError(
        workspaceMigrationInventoryFailedCode,
      );
    } finally {
      this.record(createEvent(entries, outcome, this.now() - startedAt));
    }
  }

  private record(event: Readonly<WorkspaceMigrationInventoryEvent>): void {
    try {
      this.options.observer?.record(event);
    } catch {
      // Observability must not affect the read-only inventory outcome.
    }
  }
}

async function inspectOneWorkspace(
  factory: PrivateWorkspaceMigrationInspectionRuntimeFactory,
  input: Parameters<
    PrivateWorkspaceMigrationInspectionRuntimeFactory['startMigrationInspection']
  >[0],
): Promise<Readonly<WorkspaceMigrationInspectionResult>> {
  let runtime: PrivateWorkspaceMigrationInspectionRuntime | undefined;
  try {
    runtime = await factory.startMigrationInspection(input);
    if (!(await runtime.stopAndProveHandlesClosed())) {
      throw new Error(workspaceMigrationInventoryFailedCode);
    }
    return await runtime.inspectStoppedMigrationInspection();
  } finally {
    if (runtime !== undefined) {
      await runtime.stopAndProveHandlesClosed().catch(() => false);
    }
  }
}

function createEvent(
  entries: readonly Readonly<WorkspaceMigrationInventoryEntry>[],
  outcome: WorkspaceMigrationInventoryEvent['outcome'],
  durationMs: number,
): Readonly<WorkspaceMigrationInventoryEvent> {
  return Object.freeze({
    compatiblePendingCount: entries.filter(
      (entry) => entry.status === 'compatiblePending',
    ).length,
    currentCount: entries.filter((entry) => entry.status === 'current').length,
    durationMs: Math.max(0, durationMs),
    inspectedWorkspaceCount: entries.length,
    invalidHistoryCount: entries.filter(
      (entry) => entry.status === 'invalidHistory',
    ).length,
    outcome,
  });
}

function throwIfCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new WorkspaceMigrationInventoryError(
      workspaceMigrationInventoryCancelledCode,
    );
  }
}
