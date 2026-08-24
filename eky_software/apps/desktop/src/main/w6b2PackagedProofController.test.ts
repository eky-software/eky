import { describe, expect, it, vi } from 'vitest';

import { WorkspaceManagementError } from '../workspaces/management/workspaceManagementError.js';
import type { WorkspaceManagementStatusV1 } from '../workspaces/management/workspaceManagementTypes.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { runW6b2PackagedProofController } from './w6b2PackagedProofController.js';
import type { W6b2PackagedProofConfiguration } from './w6b2PackagedProof.js';

const workspaceIds = {
  A: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
  B: validateWorkspaceId('22222222-2222-4222-8222-222222222222'),
  C: validateWorkspaceId('33333333-3333-4333-8333-333333333333'),
} as const;

describe('W6B.2 packaged proof controller', () => {
  it('uses the production cache and handoff ports for the source package', async () => {
    const fixture = createControllerFixture('sourceHandoff', 'source');
    fixture.state.quitRequested = true;

    await expect(runW6b2PackagedProofController(fixture.options)).resolves.toEqual({
      formatVersion: 1,
      phase: 'sourceHandoff',
      status: 'completed',
    });
    expect(fixture.cache.stageSelectedPackage.mock.calls).toEqual([
      [{ manifestPath: 'source-manifest', role: 'current' }],
      [{ manifestPath: 'target-manifest', role: 'candidate' }],
    ]);
    expect(fixture.handoff.prepareConfirmedUpdate).toHaveBeenCalledOnce();
    expect(fixture.handoff.handoffPreparedUpdate).toHaveBeenCalledOnce();
  });

  it('verifies target migration classification before stopping first start', async () => {
    const fixture = createControllerFixture('targetFirstStart', 'target');
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('A'));

    await expect(runW6b2PackagedProofController(fixture.options)).resolves.toEqual({
      formatVersion: 1,
      phase: 'targetFirstStart',
      status: 'completed',
    });
    expect(fixture.lifecycle.shutdown).toHaveBeenCalledOnce();
  });

  it('requests the real workspace switch and reports a bounded relaunch', async () => {
    const fixture = createControllerFixture('switchToB', 'target');
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('A'));
    fixture.workspaceManagement.switchTo.mockImplementation(async () => {
      fixture.state.relaunchRequested = true;
    });

    await expect(runW6b2PackagedProofController(fixture.options)).resolves.toEqual({
      formatVersion: 1,
      phase: 'switchToB',
      status: 'relaunching',
    });
    expect(fixture.workspaceManagement.switchTo).toHaveBeenCalledWith(
      workspaceIds.B,
    );
    expect(fixture.lifecycle.shutdown).not.toHaveBeenCalled();
  });

  it('finishes an idempotent switch phase after the relaunched target is active', async () => {
    const fixture = createControllerFixture('switchToB', 'target');
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('B'));

    await expect(runW6b2PackagedProofController(fixture.options)).resolves.toEqual({
      formatVersion: 1,
      phase: 'switchToB',
      status: 'completed',
    });
    expect(fixture.workspaceManagement.switchTo).not.toHaveBeenCalled();
    expect(fixture.lifecycle.shutdown).toHaveBeenCalledOnce();
  });

  it('requires C rejection and preserves A as the active workspace', async () => {
    const fixture = createControllerFixture('rejectC', 'target');
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('A'));
    fixture.workspaceManagement.switchTo.mockRejectedValue(
      new WorkspaceManagementError(
        'WORKSPACE_MANAGEMENT_SWITCH_FAILED',
        'switch',
      ),
    );

    await expect(runW6b2PackagedProofController(fixture.options)).resolves.toEqual({
      formatVersion: 1,
      phase: 'rejectC',
      status: 'completed',
    });
    expect(fixture.workspaceManagement.switchTo).toHaveBeenCalledWith(
      workspaceIds.C,
    );
  });

  it('maps unexpected failures to a safe closed result without raw error data', async () => {
    const fixture = createControllerFixture('verifyBRestart', 'target');
    fixture.workspaceManagement.getStatus.mockRejectedValue(
      new Error('C:/private/path secret stack'),
    );

    const result = await runW6b2PackagedProofController(fixture.options);
    expect(result).toEqual({
      errorCode: 'W6B2_PROOF_WORKSPACE_STATE_INVALID',
      formatVersion: 1,
      phase: 'verifyBRestart',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

function createControllerFixture(
  phase: W6b2PackagedProofConfiguration['phase'],
  role: W6b2PackagedProofConfiguration['role'],
) {
  const state = { quitRequested: false, relaunchRequested: false };
  const cache = { stageSelectedPackage: vi.fn().mockResolvedValue({}) };
  const handoff = {
    handoffPreparedUpdate: vi.fn().mockResolvedValue(undefined),
    prepareConfirmedUpdate: vi.fn().mockResolvedValue({}),
  };
  const lifecycle = { shutdown: vi.fn().mockResolvedValue(undefined) };
  const workspaceManagement = {
    getStatus: vi.fn(),
    switchTo: vi.fn().mockResolvedValue(undefined),
  };
  return {
    cache,
    handoff,
    lifecycle,
    options: {
      cache,
      configuration: {
        enabled: true,
        phase,
        resultFilePath: 'result',
        role,
        root: 'root',
        sourceManifestPath: 'source-manifest',
        targetManifestPath: 'target-manifest',
        userDataPath: 'user-data',
      } as W6b2PackagedProofConfiguration,
      handoff,
      isQuitRequested: () => state.quitRequested,
      isRelaunchRequested: () => state.relaunchRequested,
      lifecycle,
      workspaceManagement,
    },
    state,
    workspaceManagement,
  };
}

function status(active: 'A' | 'B'): Readonly<WorkspaceManagementStatusV1> {
  return Object.freeze({
    activeWorkspaceId: workspaceIds[active],
    formatVersion: 1,
    operationState: 'idle',
    workspaces: Object.freeze(
      (['A', 'B', 'C'] as const).map((key, index) =>
        Object.freeze({
          availability: key === 'C' ? 'recoveryRequired' : 'ready',
          isActive: key === active,
          workspaceId: workspaceIds[key],
          workspaceLabel: `First-start workspace ${index + 1}`,
        }),
      ),
    ),
  });
}
