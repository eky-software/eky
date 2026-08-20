import { randomUUID } from 'node:crypto';

import { app } from 'electron';

import type { ActiveWorkspaceLifecyclePort } from '../src/workspaces/runtime/activeWorkspaceLifecyclePort.js';
import type { WorkspaceRuntimeAbsencePort } from '../src/workspaces/runtime/workspaceRuntimeAbsencePort.js';
import type { WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';

export class ProofActiveWorkspaceLifecycle
  implements ActiveWorkspaceLifecyclePort, WorkspaceRuntimeAbsencePort
{
  backendOwners = 0;
  readonly events: string[] = [];
  modeledMaximumBackendOwners = 0;
  modeledMaximumSqliteOwners = 0;
  private activeWorkspaceId: WorkspaceId | null;
  private sqliteOwners = 0;

  constructor(activeWorkspaceId: WorkspaceId | null) {
    this.activeWorkspaceId = activeWorkspaceId;
    if (activeWorkspaceId !== null) this.setOwners(1);
  }

  async quiesceWrites(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.assertExpected(previousActiveWorkspaceId);
    this.events.push('quiesced');
  }

  recordPreRestore(): void {
    this.events.push('preRestore');
  }

  async stopAndProveHandlesClosed(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<{ readonly handlesClosed: true }> {
    this.assertExpected(previousActiveWorkspaceId);
    this.setOwners(0);
    this.events.push('stopped');
    return { handlesClosed: true };
  }

  async ensurePreviousWorkspaceRunning(
    previousActiveWorkspaceId: WorkspaceId | null,
  ): Promise<void> {
    this.activeWorkspaceId = previousActiveWorkspaceId;
    this.setOwners(previousActiveWorkspaceId === null ? 0 : 1);
    this.events.push('running');
  }

  async assertNoActiveWorkspaceRuntime(): Promise<void> {
    if (this.backendOwners !== 0 || this.sqliteOwners !== 0) {
      throw new Error('WORKSPACE_RUNTIME_ABSENCE_FAILED');
    }
    this.events.push('absent');
  }

  setRunningWorkspace(workspaceId: WorkspaceId): void {
    this.activeWorkspaceId = workspaceId;
    this.setOwners(1);
  }

  private assertExpected(workspaceId: WorkspaceId | null): void {
    if (workspaceId !== this.activeWorkspaceId) {
      throw new Error('WORKSPACE_RUNTIME_OWNERSHIP_FAILED');
    }
  }

  private setOwners(count: 0 | 1): void {
    this.backendOwners = count;
    this.sqliteOwners = count;
    this.modeledMaximumBackendOwners = Math.max(
      this.modeledMaximumBackendOwners,
      count,
    );
    this.modeledMaximumSqliteOwners = Math.max(
      this.modeledMaximumSqliteOwners,
      count,
    );
  }
}

export class ProofRuntimeRelaunch {
  requestCount = 0;

  request(): void {
    this.requestCount += 1;
  }

  complete(): void {}
}

export function captureUtilityProcessBaseline(): ReadonlySet<number> {
  return new Set(
    app
      .getAppMetrics()
      .filter((metric) => metric.type === 'Utility')
      .map((metric) => metric.pid),
  );
}

export async function waitForProofUtilityProcessesReleased(
  baselineProcessIds: ReadonlySet<number>,
): Promise<boolean> {
  const deadline = Date.now() + 5_000;
  while (hasIntroducedUtilityProcess(baselineProcessIds)) {
    if (Date.now() >= deadline) return false;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  return true;
}

export function createWorkspaceId(): WorkspaceId {
  return validateWorkspaceId(randomUUID());
}

export function readSafeErrorCode(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  ) {
    return error.code;
  }
  return error instanceof Error ? error.message : undefined;
}

export function arraysEqual(
  first: readonly string[],
  second: readonly string[],
): boolean {
  return (
    first.length === second.length &&
    first.every((value, index) => value === second[index])
  );
}

function hasIntroducedUtilityProcess(
  baselineProcessIds: ReadonlySet<number>,
): boolean {
  return app
    .getAppMetrics()
    .filter((metric) => metric.type === 'Utility')
    .some((metric) => !baselineProcessIds.has(metric.pid));
}
