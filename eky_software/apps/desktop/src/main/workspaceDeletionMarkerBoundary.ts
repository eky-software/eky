import type { RecoveryPointScheduler } from '../profileBackup/recoveryPoint/recoveryPointScheduler.js';
import { WorkspaceRuntimeStopError } from '../workspaces/runtime/mainOwnedActiveWorkspaceLifecycle.js';

/** Main's existing deferred marker, fenced before active-workspace publication. */
export function createWorkspaceDeletionMarkerBoundary(scheduler: Pick<RecoveryPointScheduler, 'markCleanShutdown'>) {
  const write = scheduler.markCleanShutdown.bind(scheduler);
  let task: Promise<void> | undefined;
  let sealed = false;
  let drained = false;
  let removed = false;
  const failure = () => new WorkspaceRuntimeStopError({ phase: 'cleanMarker', reason: 'operationFailed' });
  return Object.freeze({
    persistCleanShutdown(): Promise<void> {
      if (sealed) return removed ? Promise.resolve() : Promise.reject(failure());
      task ??= Promise.resolve().then(() => {
        if (!sealed) return write();
      }).catch(() => { throw failure(); });
      return task;
    },
    async sealActiveMarker() {
      sealed = true;
      await task;
      drained = true;
    },
    recordActiveRemoved() {
      if (!sealed || !drained || removed) throw failure();
      removed = true;
    },
  });
}
