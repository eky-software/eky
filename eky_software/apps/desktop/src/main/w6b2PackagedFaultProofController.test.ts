import { describe, expect, it, vi } from 'vitest';

import { LocalUpdateHandoffError } from '../update/localUpdateHandoffCoordinator.js';
import type { WorkspaceManagementStatusV1 } from '../workspaces/management/workspaceManagementTypes.js';
import { validateWorkspaceId } from '../workspaces/registry/workspaceIdValidation.js';
import { runW6b2PackagedFaultProofController } from './w6b2PackagedFaultProofController.js';
import type {
  W6b2PackagedFaultPhase,
  W6b2PackagedFaultProofConfiguration,
  W6b2PackagedFaultScenario,
  W6b2PackagedProofRole,
} from './w6b2PackagedProof.js';

const workspaceIds = {
  A: validateWorkspaceId('11111111-1111-4111-8111-111111111111'),
  B: validateWorkspaceId('22222222-2222-4222-8222-222222222222'),
  C: validateWorkspaceId('33333333-3333-4333-8333-333333333333'),
} as const;

describe('W6B.2 packaged fault proof controller', () => {
  it('uses the production package and handoff ports for a normal source phase', async () => {
    const fixture = createFixture(
      'activeWorkspaceFirstStartFailure',
      'sourceHandoff',
      'source',
    );
    fixture.handoff.handoffPreparedUpdate.mockImplementation(async () => {
      fixture.state.quitRequested = true;
    });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'sourceHandoff',
      status: 'completed',
    });
    expect(fixture.cache.stageSelectedPackage.mock.calls).toEqual([
      [{ manifestPath: 'source-manifest', role: 'current' }],
      [{ manifestPath: 'target-manifest', role: 'candidate' }],
    ]);
  });

  it('accepts only the injected pre-update recovery-point failure', async () => {
    const fixture = createFixture(
      'preUpdateRecoveryPointFailure',
      'sourceHandoff',
      'source',
    );
    fixture.handoff.prepareConfirmedUpdate.mockRejectedValue(
      new LocalUpdateHandoffError(
        'UPDATE_PREPARATION_RECOVERY_POINT_FAILED',
      ),
    );
    fixture.journalStore.read.mockResolvedValue({ state: 'failed' });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      faultScenario: 'preUpdateRecoveryPointFailure',
      formatVersion: 2,
      phase: 'sourceHandoff',
      status: 'completed',
    });
    expect(fixture.handoff.handoffPreparedUpdate).not.toHaveBeenCalled();
    expect(fixture.lifecycle.shutdown).toHaveBeenCalledOnce();
  });

  it('fails closed when the pre-update boundary reports another error', async () => {
    const fixture = createFixture(
      'preUpdateRecoveryPointFailure',
      'sourceHandoff',
      'source',
    );
    fixture.handoff.prepareConfirmedUpdate.mockRejectedValue(
      new Error('C:/private/recovery-point'),
    );

    const result = await runW6b2PackagedFaultProofController(
      fixture.options,
    );
    expect(result).toEqual({
      errorCode: 'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
      faultScenario: 'preUpdateRecoveryPointFailure',
      formatVersion: 2,
      phase: 'sourceHandoff',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain('private');
  });

  it('verifies the accepted target workspace and update journal', async () => {
    const fixture = createFixture(
      'passiveWorkspaceMigrationFailure',
      'targetFirstStart',
      'target',
    );
    fixture.workspaceManagement.getStatus.mockResolvedValue(
      status('A'),
    );
    fixture.journalStore.read.mockResolvedValue({ state: 'accepted' });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      faultScenario: 'passiveWorkspaceMigrationFailure',
      formatVersion: 2,
      phase: 'targetFirstStart',
      status: 'completed',
    });
    expect(fixture.lifecycle.shutdown).toHaveBeenCalledOnce();
  });

  it('keeps the isolated passive workspace unavailable while preparing the acceptance restart', async () => {
    const fixture = createFixture(
      'acceptanceInterruption',
      'targetAcceptanceRecovery',
      'target',
    );
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('A'));
    fixture.journalStore.read.mockResolvedValue({ state: 'accepted' });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      faultScenario: 'acceptanceInterruption',
      formatVersion: 2,
      phase: 'targetAcceptanceRecovery',
      status: 'relaunching',
    });
    expect(fixture.lifecycle.shutdown).toHaveBeenCalledOnce();
  });

  it('fails closed if acceptance recovery makes the isolated workspace ready', async () => {
    const fixture = createFixture(
      'acceptanceInterruption',
      'targetAcceptanceRecovery',
      'target',
    );
    fixture.workspaceManagement.getStatus.mockResolvedValue(
      status('A', 'ready'),
    );
    fixture.journalStore.read.mockResolvedValue({ state: 'accepted' });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      errorCode: 'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
      faultScenario: 'acceptanceInterruption',
      formatVersion: 2,
      phase: 'targetAcceptanceRecovery',
      status: 'failed',
    });
    expect(fixture.lifecycle.shutdown).not.toHaveBeenCalled();
  });

  it('switches through the real workspace service and requires relaunch', async () => {
    const fixture = createFixture(
      'passiveWorkspaceMigrationFailure',
      'switchToB',
      'target',
    );
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('A'));
    fixture.workspaceManagement.switchTo.mockImplementation(async () => {
      fixture.state.relaunchRequested = true;
    });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      faultScenario: 'passiveWorkspaceMigrationFailure',
      formatVersion: 2,
      phase: 'switchToB',
      status: 'relaunching',
    });
    expect(fixture.workspaceManagement.switchTo).toHaveBeenCalledWith(
      workspaceIds.B,
    );
  });

  it('verifies rollback first start only from the source package', async () => {
    const fixture = createFixture(
      'activeWorkspaceFirstStartFailure',
      'rollbackFirstStart',
      'source',
    );
    fixture.workspaceManagement.getStatus.mockResolvedValue(
      status('A', 'ready'),
    );
    fixture.journalStore.read.mockResolvedValue({ state: 'rolledBack' });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'rollbackFirstStart',
      status: 'completed',
    });
  });

  it('rejects a rollback that does not restore the source workspace registry', async () => {
    const fixture = createFixture(
      'activeWorkspaceFirstStartFailure',
      'rollbackFirstStart',
      'source',
    );
    fixture.workspaceManagement.getStatus.mockResolvedValue(status('A'));
    fixture.journalStore.read.mockResolvedValue({ state: 'rolledBack' });

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      errorCode: 'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'rollbackFirstStart',
      status: 'failed',
    });
  });

  it('fails when an intercepted fault phase reaches the controller', async () => {
    const fixture = createFixture(
      'activeWorkspaceFirstStartFailure',
      'targetFirstStartFailure',
      'target',
    );

    await expect(
      runW6b2PackagedFaultProofController(fixture.options),
    ).resolves.toEqual({
      errorCode: 'W6B2_FAULT_PROOF_EXPECTED_FAULT_NOT_OBSERVED',
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'targetFirstStartFailure',
      status: 'failed',
    });
  });

  it('maps unexpected workspace failures without exposing raw data', async () => {
    const fixture = createFixture(
      'acceptanceInterruption',
      'targetAcceptanceRecovery',
      'target',
    );
    fixture.workspaceManagement.getStatus.mockRejectedValue(
      new Error('C:/private/workspace secret stack'),
    );

    const result = await runW6b2PackagedFaultProofController(
      fixture.options,
    );
    expect(result).toEqual({
      errorCode: 'W6B2_FAULT_PROOF_WORKSPACE_STATE_INVALID',
      faultScenario: 'acceptanceInterruption',
      formatVersion: 2,
      phase: 'targetAcceptanceRecovery',
      status: 'failed',
    });
    expect(JSON.stringify(result)).not.toContain('private');
    expect(JSON.stringify(result)).not.toContain('secret');
  });
});

function createFixture(
  faultScenario: W6b2PackagedFaultScenario,
  phase: W6b2PackagedFaultPhase,
  role: W6b2PackagedProofRole,
) {
  const state = { quitRequested: false, relaunchRequested: false };
  const cache = { stageSelectedPackage: vi.fn().mockResolvedValue({}) };
  const handoff = {
    handoffPreparedUpdate: vi.fn().mockResolvedValue(undefined),
    prepareConfirmedUpdate: vi.fn().mockResolvedValue({}),
  };
  const journalStore = { read: vi.fn() };
  const lifecycle = { shutdown: vi.fn().mockResolvedValue(undefined) };
  const workspaceManagement = {
    getStatus: vi.fn(),
    switchTo: vi.fn().mockResolvedValue(undefined),
  };
  const configuration: W6b2PackagedFaultProofConfiguration = {
    controlFormatVersion: 2,
    enabled: true,
    faultScenario,
    phase,
    resultFilePath: 'result',
    role,
    root: 'root',
    sourceManifestPath: 'source-manifest',
    targetManifestPath: 'target-manifest',
    userDataPath: 'user-data',
  };
  return {
    cache,
    handoff,
    journalStore,
    lifecycle,
    options: {
      cache,
      configuration,
      handoff,
      isQuitRequested: () => state.quitRequested,
      isRelaunchRequested: () => state.relaunchRequested,
      journalStore,
      lifecycle,
      workspaceManagement,
    },
    state,
    workspaceManagement,
  };
}

function status(
  active: 'A' | 'B',
  cAvailability: 'ready' | 'recoveryRequired' = 'recoveryRequired',
): Readonly<WorkspaceManagementStatusV1> {
  return Object.freeze({
    activeWorkspaceId: workspaceIds[active],
    formatVersion: 1,
    operationState: 'idle',
    workspaces: Object.freeze(
      (['A', 'B', 'C'] as const).map((key, index) =>
        Object.freeze({
          availability: key === 'C' ? cAvailability : 'ready',
          isActive: key === active,
          workspaceId: workspaceIds[key],
          workspaceLabel: `First-start workspace ${index + 1}`,
        }),
      ),
    ),
  });
}
