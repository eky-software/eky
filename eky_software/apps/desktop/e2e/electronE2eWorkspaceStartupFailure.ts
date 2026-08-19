import { readSafeStartupFailureCode } from '../src/main/earlyStartup.js';
import type { ActiveWorkspaceStartupPhase } from '../src/workspaces/runtime/resolveActiveWorkspaceStartup.js';

const phaseFailureCodes = Object.freeze({
  legacyAdoption: 'DESKTOP_SMOKE_E2E_WORKSPACE_ADOPTION_FAILED',
  registryStateRead: 'DESKTOP_SMOKE_E2E_WORKSPACE_REGISTRY_READ_FAILED',
  switchRecovery: 'DESKTOP_SMOKE_E2E_WORKSPACE_SWITCH_RECOVERY_FAILED',
  workspaceRootInspection:
    'DESKTOP_SMOKE_E2E_WORKSPACE_ROOT_INSPECTION_FAILED',
} satisfies Record<ActiveWorkspaceStartupPhase, string>);

export function readSafeElectronE2eWorkspaceStartupFailureCode(
  error: unknown,
  phase: ActiveWorkspaceStartupPhase | undefined,
): string {
  const safeErrorCode = readSafeStartupFailureCode(error);
  if (safeErrorCode !== 'DESKTOP_START_FAILED') return safeErrorCode;
  return phase === undefined
    ? 'DESKTOP_SMOKE_E2E_WORKSPACE_RESOLUTION_FAILED'
    : phaseFailureCodes[phase];
}
