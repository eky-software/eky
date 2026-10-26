import { isDeepStrictEqual } from 'node:util';

import type { DesktopLifecycleHandle } from '../src/main/desktopComposition.js';
import type { LocalWorkspaceRegistry, WorkspaceId } from '../src/workspaces/registry/workspaceRegistryTypes.js';
import type { WorkspaceSwitchJournalStore } from '../src/workspaces/switch/workspaceSwitchJournal.js';

export function requireActivationProofRegistry(
  registry: Readonly<LocalWorkspaceRegistry> | undefined,
  expectedFormat: LocalWorkspaceRegistry['formatVersion'],
): Readonly<LocalWorkspaceRegistry> {
  if (registry === undefined || registry.formatVersion !== expectedFormat) {
    throw new Error('WORKSPACE_ACTIVATION_PROOF_REGISTRY_INVALID');
  }
  return registry;
}

export async function proveSelectorActivationOpening(input: {
  readonly window: Pick<DesktopLifecycleHandle['applicationWindow'], 'isDestroyed' | 'destroy'> & {
    readonly webContents: Pick<DesktopLifecycleHandle['applicationWindow']['webContents'], 'executeJavaScript'>;
  };
  readonly targetWorkspaceId: WorkspaceId;
  readRegistry(): Promise<Readonly<LocalWorkspaceRegistry> | undefined>;
  inspectSwitchSlots(): ReturnType<WorkspaceSwitchJournalStore['inspectSlots']>;
  readRuntime(): Readonly<{ backendStarts: number; sessionStarts: number; relaunches: number }>;
  stop(): Promise<void>;
  recordCleanupFailure(): void;
}): Promise<void> {
  let failed = false;
  try {
    const before = requireActivationProofRegistry(await input.readRegistry(), 2);
    if (before.activeWorkspaceId !== null ||
        !isDeepStrictEqual(input.readRuntime(), { backendStarts: 0, sessionStarts: 0, relaunches: 0 })) {
      throw new Error('WORKSPACE_ACTIVATION_PROOF_SELECTOR_STARTED_BUSINESS');
    }
    // Use the real sandboxed preload/IPC path, not a seeded switch journal.
    const result: unknown = await input.window.webContents.executeJavaScript(
      `window.ekyDesktop.switchWorkspace(${JSON.stringify({ workspaceId: input.targetWorkspaceId })})`,
    );
    const after = requireActivationProofRegistry(await input.readRegistry(), 2);
    const slots = await input.inspectSwitchSlots();
    const journal = slots.current?.value;
    if (!isDeepStrictEqual(result, { formatVersion: 1, status: 'relaunching' }) ||
        !isDeepStrictEqual(input.readRuntime(), { backendStarts: 0, sessionStarts: 0, relaunches: 1 }) ||
        after.activeWorkspaceId !== input.targetWorkspaceId ||
        !isDeepStrictEqual(after.workspaces, before.workspaces) ||
        slots.next !== undefined || slots.backup !== undefined ||
        journal?.formatVersion !== 2 || journal.sourceWorkspaceId !== null ||
        journal.targetWorkspaceId !== input.targetWorkspaceId || journal.state !== 'targetSelected') {
      throw new Error('WORKSPACE_ACTIVATION_PROOF_SELECTOR_SELECTION_INVALID');
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await input.stop();
      if (!input.window.isDestroyed()) input.window.destroy();
    } catch (error) {
      // An uncertain shutdown leaves the window owned by the outer Electron
      // fixture. It also forbids removal of this proof's retained evidence.
      input.recordCleanupFailure();
      if (!failed) throw error;
    }
  }
}
