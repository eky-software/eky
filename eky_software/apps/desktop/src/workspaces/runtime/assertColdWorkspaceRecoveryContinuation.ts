import { deriveWorkspaceRoot } from '../registry/deriveWorkspaceRoot.js';
import { inspectWorkspaceRoot } from '../registry/inspectWorkspaceRoot.js';
import type { WorkspaceRegistryPort } from '../registry/workspaceRegistryPort.js';
import { serializeWorkspaceRegistry } from '../registry/workspaceRegistrySerializer.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../registry/workspaceRegistryValidation.js';

export async function assertColdWorkspaceRecoveryContinuation(options: {
  readonly expectedRegistry: Readonly<LocalWorkspaceRegistryV1>;
  readonly expectedWorkspaceId: WorkspaceId | null;
  readonly registry: WorkspaceRegistryPort;
  readonly userDataRoot: string;
}): Promise<void> {
  const expected = validateWorkspaceRegistry(options.expectedRegistry);
  const workspace = expected.workspaces.find(
    (entry) => entry.workspaceId === options.expectedWorkspaceId,
  );
  if (
    options.expectedWorkspaceId === null ||
    expected.activeWorkspaceId !== options.expectedWorkspaceId ||
    workspace?.lifecycleState !== 'ready'
  ) {
    throw new Error('WORKSPACE_RECOVERY_CONTINUATION_INVALID');
  }
  const assertRegistryUnchanged = () => assertColdWorkspaceRecoveryRegistryUnchanged({
    expectedRegistry: expected,
    registry: options.registry,
  });
  await assertRegistryUnchanged();
  // This proves the continuation's root, not business-runtime health.
  await inspectWorkspaceRoot(deriveWorkspaceRoot(
    options.userDataRoot,
    workspace.workspaceId,
    workspace.layoutVersion,
  ));
  await assertRegistryUnchanged();
}

export async function assertColdWorkspaceRecoveryRegistryUnchanged(options: {
  readonly expectedRegistry: Readonly<LocalWorkspaceRegistryV1> | undefined;
  readonly registry: WorkspaceRegistryPort;
}): Promise<void> {
  const actual = await options.registry.read();
  if (options.expectedRegistry === undefined || actual === undefined) {
    if (options.expectedRegistry !== actual) {
      throw new Error('WORKSPACE_RECOVERY_CONTINUATION_INVALID');
    }
    return;
  }
  if (!Buffer.from(serializeWorkspaceRegistry(options.expectedRegistry))
    .equals(serializeWorkspaceRegistry(actual))) {
    throw new Error('WORKSPACE_RECOVERY_CONTINUATION_INVALID');
  }
}
