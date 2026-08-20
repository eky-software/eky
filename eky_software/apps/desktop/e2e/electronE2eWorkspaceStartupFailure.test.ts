import { describe, expect, it } from 'vitest';

import { readSafeElectronE2eWorkspaceStartupFailureCode } from './electronE2eWorkspaceStartupFailure.js';

describe('Electron E2E workspace startup failure reporting', () => {
  it.each([
    ['registryStateRead', 'DESKTOP_SMOKE_E2E_WORKSPACE_REGISTRY_READ_FAILED'],
    ['legacyAdoption', 'DESKTOP_SMOKE_E2E_WORKSPACE_ADOPTION_FAILED'],
    [
      'legacyAdoptionRecovery',
      'DESKTOP_SMOKE_E2E_WORKSPACE_ADOPTION_RECOVERY_FAILED',
    ],
    ['switchRecovery', 'DESKTOP_SMOKE_E2E_WORKSPACE_SWITCH_RECOVERY_FAILED'],
    [
      'workspaceRootInspection',
      'DESKTOP_SMOKE_E2E_WORKSPACE_ROOT_INSPECTION_FAILED',
    ],
  ] as const)('reports the closed %s failure without raw details', (phase, code) => {
    expect(
      readSafeElectronE2eWorkspaceStartupFailureCode(
        new Error('private path and stack detail'),
        phase,
      ),
    ).toBe(code);
  });

  it('preserves an existing allowlisted startup failure', () => {
    expect(
      readSafeElectronE2eWorkspaceStartupFailureCode(
        new Error('WORKSPACE_ADOPTION_RECOVERY_REQUIRED'),
        'legacyAdoption',
      ),
    ).toBe('WORKSPACE_ADOPTION_RECOVERY_REQUIRED');
  });

  it('uses the generic closed failure before any phase starts', () => {
    expect(
      readSafeElectronE2eWorkspaceStartupFailureCode(
        new Error('private path and stack detail'),
        undefined,
      ),
    ).toBe('DESKTOP_SMOKE_E2E_WORKSPACE_RESOLUTION_FAILED');
  });
});
