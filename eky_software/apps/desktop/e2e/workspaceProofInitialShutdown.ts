import type { DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import {
  WorkspaceRuntimeStopError, workspaceRuntimeStopPhases, workspaceRuntimeStopReasons,
} from '../src/workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';

// Playwright's evaluate error transport drops structured Error.cause values.
// Keep the owned, closed runtime reason in this test-only boundary's message.
export async function shutdownBeforeWorkspaceProof(
  lifecycle: Pick<DesktopLifecycleHandle, 'shutdown'>,
): Promise<void> {
  try {
    await lifecycle.shutdown();
  } catch (error) {
    const detail = readOwnedFailure(error);
    if (detail === undefined) throw error;
    throw new Error(`E2E_INITIAL_SHUTDOWN_FAILED: ${detail}`, { cause: error });
  }
}

function readOwnedFailure(error: unknown): string | undefined {
  try {
    const cause = ownData(error, 'cause');
    const runtime = cause instanceof WorkspaceRuntimeStopError
      ? cause : ownData(cause, 'runtimeFailure');
    if (!(runtime instanceof WorkspaceRuntimeStopError)) return undefined;
    const firstFailure = ownData(runtime, 'firstFailure');
    // The constructor owns this frozen two-field value; do not inspect other
    // exception properties, arbitrary causes, cleanup objects or secret values.
    if (typeof firstFailure !== 'object' || firstFailure === null ||
        !Object.isFrozen(firstFailure) || Object.keys(firstFailure).sort().join(',') !== 'phase,reason') return undefined;
    const phase = ownData(firstFailure, 'phase');
    const reason = ownData(firstFailure, 'reason');
    if (!workspaceRuntimeStopPhases.some(value => value === phase) ||
        !workspaceRuntimeStopReasons.some(value => value === reason)) return undefined;
    return `${phase}/${reason}`;
  } catch { return undefined; }
}

function ownData(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
}
