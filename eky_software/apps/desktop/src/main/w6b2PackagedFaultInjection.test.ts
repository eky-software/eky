import { describe, expect, it, vi } from 'vitest';

import type {
  W6b2PackagedFaultPhase,
  W6b2PackagedFaultScenario,
  W6b2PackagedProofConfiguration,
} from './w6b2PackagedProof.js';
import {
  createW6b2PackagedFaultInjection,
  createW6b2PackagedHandoffProfileProtection,
  W6b2PackagedFaultInjectedError,
} from './w6b2PackagedFaultInjection.js';
import type { UpdateProfileProtection } from '../update/profileProtectionComposition.js';

describe('W6B.2 packaged fault injection', () => {
  it('is absent for the version 1 success proof', () => {
    expect(
      createW6b2PackagedFaultInjection({
        configuration: successConfiguration(),
        interruptProcess: vi.fn(),
      }),
    ).toBeUndefined();
  });

  it.each([
    [
      'preUpdateRecoveryPointFailure',
      'sourceHandoff',
      'failPreUpdateRecoveryPointIfRequested',
    ],
    [
      'activeWorkspaceFirstStartFailure',
      'targetFirstStartFailure',
      'failActiveWorkspaceFirstStartIfRequested',
    ],
    [
      'passiveWorkspaceMigrationFailure',
      'passiveWorkspaceMigrationFailure',
      'failPassiveWorkspaceMigrationIfRequested',
    ],
    [
      'binaryRollbackFailure',
      'binaryRollbackFailure',
      'failBinaryRollbackLaunchIfRequested',
    ],
  ] as const)(
    'injects only the exact %s/%s fault boundary',
    (faultScenario, phase, method) => {
      const injection = createW6b2PackagedFaultInjection({
        configuration: faultConfiguration(faultScenario, phase),
        interruptProcess: vi.fn(),
      });
      expect(() => injection?.[method]()).toThrow(
        W6b2PackagedFaultInjectedError,
      );
    },
  );

  it('does not inject at an unrelated phase of the same scenario', () => {
    const injection = createW6b2PackagedFaultInjection({
      configuration: faultConfiguration(
        'binaryRollbackFailure',
        'businessRollback',
      ),
      interruptProcess: vi.fn(),
    });
    expect(() => injection?.failBinaryRollbackLaunchIfRequested()).not.toThrow();
    expect(() =>
      injection?.failActiveWorkspaceFirstStartIfRequested(),
    ).not.toThrow();
  });

  it('delegates the exact acceptance interruption without returning', async () => {
    const interrupted = new Error('interrupted');
    const interruptProcess = vi.fn(async (): Promise<never> => {
      throw interrupted;
    });
    const configuration = faultConfiguration(
      'acceptanceInterruption',
      'targetAcceptanceInterruption',
    );
    const injection = createW6b2PackagedFaultInjection({
      configuration,
      interruptProcess,
    });

    await expect(
      injection?.interruptAfterRegistryTransitionIfRequested(),
    ).rejects.toBe(interrupted);
    expect(interruptProcess).toHaveBeenCalledWith(configuration);
  });

  it('injects before pre-update recovery point creation and preserves the port', async () => {
    const calls: string[] = [];
    const profileProtection = createProfileProtection(calls);
    const injection = createW6b2PackagedFaultInjection({
      configuration: faultConfiguration(
        'preUpdateRecoveryPointFailure',
        'sourceHandoff',
      ),
      interruptProcess: vi.fn(),
    });
    const protectedPort = createW6b2PackagedHandoffProfileProtection(
      profileProtection,
      injection,
    );

    await expect(
      protectedPort.createValidatedPreUpdatePoint('11111111-1111-4111-8111-111111111111'),
    ).rejects.toBeInstanceOf(W6b2PackagedFaultInjectedError);
    expect(calls).toEqual([]);
    await expect(protectedPort.validateActiveProfile()).resolves.toMatchObject({
      databaseHealth: 'healthy',
    });
    expect(calls).toEqual(['validateActiveProfile']);
  });

  it('returns the original profile protection outside a fault proof', () => {
    const profileProtection = createProfileProtection([]);
    expect(
      createW6b2PackagedHandoffProfileProtection(
        profileProtection,
        undefined,
      ),
    ).toBe(profileProtection);
  });

  it('forwards the same update owner through the packaged fault wrapper', async () => {
    const profileProtection = createProfileProtection([]);
    const operationId = '11111111-1111-4111-8111-111111111111';
    const methods = [
      'beginUpdateMaintenance', 'assertUpdateMaintenance',
      'createValidatedPreUpdatePoint', 'endUpdateMaintenance',
    ] as const;
    const spies = methods.map(method => vi.spyOn(profileProtection, method));
    const injection = createW6b2PackagedFaultInjection({
      configuration: faultConfiguration('activeWorkspaceFirstStartFailure', 'targetFirstStartFailure'),
      interruptProcess: vi.fn(),
    });
    const protectedPort = createW6b2PackagedHandoffProfileProtection(profileProtection, injection);
    for (const method of methods) await protectedPort[method](operationId);
    for (const spy of spies) expect(spy).toHaveBeenCalledExactlyOnceWith(operationId);
  });
});

function createProfileProtection(calls: string[]): UpdateProfileProtection {
  return {
    async createValidatedPreMigrationPoint() {
      calls.push('createValidatedPreMigrationPoint');
      return 'point';
    },
    async createValidatedPreUpdatePoint() {
      calls.push('createValidatedPreUpdatePoint');
      return 'point';
    },
    async beginUpdateMaintenance() {
      calls.push('beginUpdateMaintenance');
    },
    async assertUpdateMaintenance() {
      calls.push('assertUpdateMaintenance');
    },
    async endUpdateMaintenance() {
      calls.push('endUpdateMaintenance');
    },
    async enterMaintenance() {
      calls.push('enterMaintenance');
    },
    async leaveMaintenance() {
      calls.push('leaveMaintenance');
    },
    async releaseProtectedPoint() {
      calls.push('releaseProtectedPoint');
    },
    async restoreRecoveryPoint() {
      calls.push('restoreRecoveryPoint');
      return 'relaunching';
    },
    async validateActiveProfile() {
      calls.push('validateActiveProfile');
      return {
        artifactCount: 1,
        artifactTotalByteSize: 1,
        databaseHealth: 'healthy',
        migrationChainIdentity: 'a'.repeat(64),
      };
    },
  };
}

function successConfiguration(): W6b2PackagedProofConfiguration {
  return Object.freeze({
    controlFormatVersion: 1,
    enabled: true,
    phase: 'sourceHandoff',
    resultFilePath: '/tmp/result',
    role: 'source',
    root: '/tmp/root',
    sourceManifestPath: '/tmp/source',
    targetManifestPath: '/tmp/target',
    userDataPath: '/tmp/user-data',
  });
}

function faultConfiguration(
  faultScenario: W6b2PackagedFaultScenario,
  phase: W6b2PackagedFaultPhase,
): W6b2PackagedProofConfiguration {
  return Object.freeze({
    controlFormatVersion: 2,
    enabled: true,
    faultScenario,
    phase,
    resultFilePath: '/tmp/result',
    role:
      phase === 'sourceHandoff' || phase === 'rollbackFirstStart'
        ? 'source'
        : 'target',
    root: '/tmp/root',
    sourceManifestPath: '/tmp/source',
    targetManifestPath: '/tmp/target',
    userDataPath: '/tmp/user-data',
  });
}
