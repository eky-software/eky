import type { WorkspaceMaintenanceLease } from '../maintenance/workspaceMaintenanceLease.js';
import { sameCrashSafeFileSlotIdentity } from '../persistence/crashSafeFileSlot.js';
import { validateWorkspaceId } from '../registry/workspaceIdValidation.js';
import { validateWorkspaceLabel } from '../registry/workspaceLabelValidation.js';
import {
  readWorkspaceRegistry,
  renameWorkspaceLabel,
} from '../registry/workspaceRegistryMutations.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type { WorkspaceRegistryStore } from '../registry/workspaceRegistryStore.js';
import type { WorkspaceId } from '../registry/workspaceRegistryTypes.js';
import {
  mapWorkspaceManagementError,
  WorkspaceManagementError,
} from './workspaceManagementError.js';
import type { WorkspaceManagementOperationGuard } from './workspaceManagementOperationGuard.js';

export interface WorkspaceLabelRenameResult {
  readonly changed: boolean;
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
}

type WorkspaceLabelRenameOptions = Readonly<{
  maintenanceLease: WorkspaceMaintenanceLease;
  operationGuard: WorkspaceManagementOperationGuard;
}> & (Readonly<{ mode?: 'active'; registry: WorkspaceRegistryPort }> | Readonly<{
  mode: 'selector';
  registry: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected'>;
  assertCurrent(): void;
  captureCurrentOwner(): () => void;
}>);

export class WorkspaceLabelRename {
  constructor(
    private readonly options: WorkspaceLabelRenameOptions,
  ) {}

  async rename(
    workspaceIdInput: unknown,
    workspaceLabelInput: unknown,
  ): Promise<Readonly<WorkspaceLabelRenameResult>> {
    let workspaceId: WorkspaceId;
    let workspaceLabel: string;
    try {
      workspaceId = validateWorkspaceId(workspaceIdInput);
      workspaceLabel = validateWorkspaceLabel(workspaceLabelInput);
    } catch {
      throw new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_INVALID',
        'rename',
      );
    }
    const lease = await this.options.maintenanceLease
      .acquire('rename')
      .catch((error) => {
        throw mapWorkspaceManagementError(error, 'rename');
      });
    let operationError: WorkspaceManagementError | undefined;
    let result: Readonly<WorkspaceLabelRenameResult> | undefined;
    try {
      const assertSelectorCurrent = this.options.mode === 'selector'
        ? captureSelectorAuthority(this.options) : undefined;
      assertSelectorCurrent?.();
      await this.options.operationGuard.assertNoUnresolvedOperations();
      assertSelectorCurrent?.();
      let changed: boolean;
      if (this.options.mode === 'selector') {
        changed = await this.renameSelector(this.options.registry, workspaceId, workspaceLabel, assertSelectorCurrent!);
      } else {
        const registry = readWorkspaceRegistry(await this.options.registry.read());
        const next = renameWorkspaceLabel(registry, workspaceId, workspaceLabel);
        if (next !== registry) await this.options.registry.write(next);
        changed = next !== registry;
      }
      result = Object.freeze({
        changed,
        workspaceId,
        workspaceLabel,
      });
    } catch (error) {
      operationError = mapWorkspaceManagementError(error, 'rename');
    }
    try {
      await lease.release();
    } catch (error) {
      operationError ??= mapWorkspaceManagementError(error, 'rename');
    }
    if (operationError !== undefined) throw operationError;
    return result!;
  }

  private async renameSelector(
    store: Pick<WorkspaceRegistryStore, 'inspectSlots' | 'writeSelected'>,
    workspaceId: WorkspaceId, workspaceLabel: string, assertAuthority: () => void,
  ): Promise<boolean> {
    assertAuthority();
    const slots = await store.inspectSlots();
    assertAuthority();
    const current = slots.current;
    if (current?.value.formatVersion !== 2 || current.value.activeWorkspaceId !== null ||
        current.identity === undefined || slots.next !== undefined || slots.backup !== undefined) {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'rename');
    }
    const next = renameWorkspaceLabel(current.value, workspaceId, workspaceLabel);
    const changed = next !== current.value;
    // The held lease excludes other admitted mutations. The existing selected
    // writer rechecks this owner and exact registry bytes/identity at every step.
    const identity = changed ? await store.writeSelected(next, {
      expectedSlots: { current: current.bytes, next: undefined, backup: undefined },
      expectedIdentities: { current: current.identity, next: undefined, backup: undefined },
      assertAuthority,
      async assertExternalSelection() { assertAuthority(); },
    }) : current.identity;
    assertAuthority();
    const actual = await store.inspectSlots();
    assertAuthority();
    const expectedBytes = changed ? serializeWorkspaceRegistry(next) : current.bytes;
    if (actual.current?.identity === undefined || actual.next !== undefined || actual.backup !== undefined ||
        !sameCrashSafeFileSlotIdentity(identity, actual.current.identity) ||
        !Buffer.from(expectedBytes).equals(actual.current.bytes)) {
      throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'rename');
    }
    return changed;
  }
}

function captureSelectorAuthority(options: Extract<WorkspaceLabelRenameOptions, { mode: 'selector' }>): () => void {
  const assertCurrent = options.assertCurrent.bind(options);
  const assertLease = options.captureCurrentOwner();
  return () => {
    for (const assert of [assertCurrent, assertLease]) {
      const result: unknown = assert();
      if (result !== undefined) {
        void Promise.resolve(result).catch(() => undefined);
        throw new WorkspaceManagementError('WORKSPACE_MANAGEMENT_RECOVERY_REQUIRED', 'rename');
      }
    }
  };
}
