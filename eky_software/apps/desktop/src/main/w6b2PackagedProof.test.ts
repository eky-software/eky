import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createW6b2PackagedProofFallbackResult,
  createW6b2PackagedProofBootstrapConfiguration,
  createW6b2PackagedProofUnexpectedFailure,
  parseW6b2PackagedProofResult,
  readW6b2PackagedProofConfiguration,
  resolveW6b2PackagedRollbackProgressPath,
  W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
  W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH,
  writeW6b2PackagedProofResult,
} from './w6b2PackagedProof.js';

const temporaryRoots: string[] = [];
const token = 'a'.repeat(64);

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { force: true, recursive: true }),
    ),
  );
});

describe('W6B.2 packaged proof configuration', () => {
  it('derives rollback progress only for the private active rollback phase', () => {
    const configuration = {
      controlFormatVersion: 2 as const,
      enabled: true as const,
      faultScenario: 'activeWorkspaceFirstStartFailure' as const,
      phase: 'businessRollback' as const,
      resultFilePath: '/tmp/proof/result/w6b2-proof-result.json',
      role: 'target' as const,
      root: '/tmp/proof',
      sourceManifestPath: '/tmp/proof/packages/source/manifest.json',
      targetManifestPath: '/tmp/proof/packages/target/manifest.json',
      userDataPath: '/tmp/proof/user-data',
    };
    expect(resolveW6b2PackagedRollbackProgressPath(configuration)).toBe(
      join(
        configuration.root,
        'result',
        'w6b2-rollback-installer-progress.jsonl',
      ),
    );
    expect(
      resolveW6b2PackagedRollbackProgressPath({
        ...configuration,
        phase: 'targetFirstStartFailure',
      }),
    ).toBeUndefined();
    expect(resolveW6b2PackagedRollbackProgressPath(undefined)).toBeUndefined();
  });

  it('stays disabled without the closed command-line switch', () => {
    expect(
      createW6b2PackagedProofBootstrapConfiguration({
        hasProofSwitch: false,
        tempPath: tmpdir(),
        tokenValue: token,
      }),
    ).toEqual({ enabled: false, root: undefined, userDataPath: undefined });
  });

  it('derives every path from a strict token under the canonical temp root', async () => {
    const { bootstrap, resourcesPath, root } = await createProofFiles({
      phase: 'sourceHandoff',
      role: 'source',
    });
    expect(bootstrap.root).toBe(root);
    expect(bootstrap.userDataPath).toBe(join(root, 'user-data'));

    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.7',
        bootstrap,
        resourcesPath,
      }),
    ).resolves.toEqual({
      controlFormatVersion: 1,
      enabled: true,
      phase: 'sourceHandoff',
      resultFilePath: join(root, 'result', 'w6b2-proof-result.json'),
      role: 'source',
      root,
      sourceManifestPath: join(root, 'packages', 'source', 'manifest.json'),
      targetManifestPath: join(root, 'packages', 'target', 'manifest.json'),
      userDataPath: join(root, 'user-data'),
    });
  });

  it('accepts only the strict scenario, phase and package role matrix for fault proofs', async () => {
    const proof = await createFaultProofFiles({
      faultScenario: 'activeWorkspaceFirstStartFailure',
      phase: 'targetFirstStartFailure',
      role: 'target',
    });
    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.8',
        bootstrap: proof.bootstrap,
        resourcesPath: proof.resourcesPath,
      }),
    ).resolves.toEqual({
      controlFormatVersion: 2,
      enabled: true,
      faultScenario: 'activeWorkspaceFirstStartFailure',
      phase: 'targetFirstStartFailure',
      resultFilePath: join(
        proof.root,
        'result',
        'w6b2-proof-result.json',
      ),
      role: 'target',
      root: proof.root,
      sourceManifestPath: join(
        proof.root,
        'packages',
        'source',
        'manifest.json',
      ),
      targetManifestPath: join(
        proof.root,
        'packages',
        'target',
        'manifest.json',
      ),
      userDataPath: join(proof.root, 'user-data'),
    });

    const wrongScenarioPhase = await createFaultProofFiles({
      faultScenario: 'preUpdateRecoveryPointFailure',
      phase: 'targetFirstStartFailure',
      role: 'target',
    });
    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.8',
        bootstrap: wrongScenarioPhase.bootstrap,
        resourcesPath: wrongScenarioPhase.resourcesPath,
      }),
    ).rejects.toThrow('W6B2_PROOF_CONFIGURATION_INVALID');

    const wrongRole = await createFaultProofFiles({
      faultScenario: 'activeWorkspaceFirstStartFailure',
      phase: 'rollbackFirstStart',
      role: 'target',
    });
    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.8',
        bootstrap: wrongRole.bootstrap,
        resourcesPath: wrongRole.resourcesPath,
      }),
    ).rejects.toThrow('W6B2_PROOF_CONFIGURATION_INVALID');
  });

  it('fails closed for invalid tokens, marker identities and phase-role pairs', async () => {
    expect(() =>
      createW6b2PackagedProofBootstrapConfiguration({
        hasProofSwitch: true,
        tempPath: tmpdir(),
        tokenValue: '../unsafe',
      }),
    ).toThrow('W6B2_PROOF_CONFIGURATION_INVALID');

    const target = await createProofFiles({
      phase: 'sourceHandoff',
      role: 'target',
    });
    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.8',
        bootstrap: target.bootstrap,
        resourcesPath: target.resourcesPath,
      }),
    ).rejects.toThrow('W6B2_PROOF_CONFIGURATION_INVALID');

    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.8',
        bootstrap: {
          ...target.bootstrap,
          userDataPath: join(target.root, 'other-user-data'),
        },
        resourcesPath: target.resourcesPath,
      }),
    ).rejects.toThrow('W6B2_PROOF_CONFIGURATION_INVALID');

    await writeFile(
      join(target.resourcesPath, 'backend', 'w6b2-private-proof-v1.json'),
      '{"appVersion":"0.2.8","formatVersion":1,"role":"target","path":"C:/unsafe"}\n',
      'utf8',
    );
    await expect(
      readW6b2PackagedProofConfiguration({
        appVersion: '0.2.8',
        bootstrap: target.bootstrap,
        resourcesPath: target.resourcesPath,
      }),
    ).rejects.toThrow('W6B2_PROOF_PACKAGE_MARKER_INVALID');
  });

  it('writes only the closed safe result shape', async () => {
    const proof = await createProofFiles({
      phase: 'switchToB',
      role: 'target',
    });
    const configuration = await readW6b2PackagedProofConfiguration({
      appVersion: '0.2.8',
      bootstrap: proof.bootstrap,
      resourcesPath: proof.resourcesPath,
    });
    expect(configuration).toBeDefined();

    await writeW6b2PackagedProofResult(configuration!, {
      formatVersion: 1,
      phase: 'switchToB',
      status: 'relaunching',
    });
    expect(
      await readFile(configuration!.resultFilePath, 'utf8'),
    ).toBe(
      '{"formatVersion":1,"phase":"switchToB","status":"relaunching"}\n',
    );
    expect(() =>
      parseW6b2PackagedProofResult({
        formatVersion: 1,
        path: 'C:/unsafe',
        phase: 'switchToB',
        status: 'completed',
      }),
    ).toThrow('W6B2_PROOF_RESULT_INVALID');
    expect(
      parseW6b2PackagedProofResult({
        errorCode:
          'W6B2_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED',
        formatVersion: 1,
        phase: 'sourceHandoff',
        status: 'failed',
      }),
    ).toEqual({
      errorCode:
        'W6B2_PROOF_PREPARATION_RECOVERY_POINT_STORAGE_FAILED',
      formatVersion: 1,
      phase: 'sourceHandoff',
      status: 'failed',
    });
  });

  it.each([
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_ARTIFACTS_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_OPERATION_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_REQUEST_INVALID',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_BROKER_UNAVAILABLE',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_DATABASE_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_STAGING_FAILED',
    'W6B2_PROOF_PREPARATION_RECOVERY_POINT_SNAPSHOT_VALIDATION_FAILED',
  ] as const)('accepts the closed snapshot failure code %s', (errorCode) => {
    expect(
      parseW6b2PackagedProofResult({
        errorCode,
        formatVersion: 1,
        phase: 'sourceHandoff',
        status: 'failed',
      }),
    ).toEqual({
      errorCode,
      formatVersion: 1,
      phase: 'sourceHandoff',
      status: 'failed',
    });
  });

  it('writes and parses only the strict version 2 fault result shape', async () => {
    const proof = await createFaultProofFiles({
      faultScenario: 'acceptanceInterruption',
      phase: 'targetAcceptanceInterruption',
      role: 'target',
    });
    const configuration = await readW6b2PackagedProofConfiguration({
      appVersion: '0.2.8',
      bootstrap: proof.bootstrap,
      resourcesPath: proof.resourcesPath,
    });
    expect(configuration).toBeDefined();

    await writeW6b2PackagedProofResult(configuration!, {
      faultScenario: 'acceptanceInterruption',
      formatVersion: 2,
      phase: 'targetAcceptanceInterruption',
      status: 'interrupted',
    });
    expect(await readFile(configuration!.resultFilePath, 'utf8')).toBe(
      '{"faultScenario":"acceptanceInterruption","formatVersion":2,"phase":"targetAcceptanceInterruption","status":"interrupted"}\n',
    );
    expect(() =>
      parseW6b2PackagedProofResult({
        faultScenario: 'acceptanceInterruption',
        formatVersion: 2,
        path: 'C:/unsafe',
        phase: 'targetAcceptanceInterruption',
        status: 'interrupted',
      }),
    ).toThrow('W6B2_PROOF_RESULT_INVALID');
    expect(() =>
      parseW6b2PackagedProofResult({
        faultScenario: 'preUpdateRecoveryPointFailure',
        formatVersion: 2,
        phase: 'targetFirstStartFailure',
        status: 'completed',
      }),
    ).toThrow('W6B2_PROOF_RESULT_INVALID');

    await expect(
      writeW6b2PackagedProofResult(configuration!, {
        faultScenario: 'acceptanceInterruption',
        formatVersion: 2,
        phase: 'targetAcceptanceRecovery',
        status: 'completed',
      }),
    ).rejects.toThrow('W6B2_PROOF_RESULT_INVALID');

    await expect(
      writeW6b2PackagedProofResult(configuration!, {
        faultScenario: 'activeWorkspaceFirstStartFailure',
        formatVersion: 2,
        phase: 'targetFirstStartFailure',
        status: 'completed',
      }),
    ).rejects.toThrow('W6B2_PROOF_RESULT_INVALID');
  });

  it('creates version-matched fallback and safe startup failure results', async () => {
    const proof = await createFaultProofFiles({
      faultScenario: 'activeWorkspaceFirstStartFailure',
      phase: 'targetFirstStartFailure',
      role: 'target',
    });
    const configuration = await readW6b2PackagedProofConfiguration({
      appVersion: '0.2.8',
      bootstrap: proof.bootstrap,
      resourcesPath: proof.resourcesPath,
    });
    expect(configuration?.controlFormatVersion).toBe(2);

    expect(
      createW6b2PackagedProofFallbackResult(configuration!, {
        quitRequested: false,
        relaunchRequested: true,
      }),
    ).toEqual({
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'targetFirstStartFailure',
      status: 'relaunching',
    });
    expect(
      createW6b2PackagedProofFallbackResult(configuration!, {
        quitRequested: false,
        relaunchRequested: false,
      }),
    ).toEqual({
      errorCode: 'W6B2_FAULT_PROOF_UNEXPECTED',
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'targetFirstStartFailure',
      status: 'failed',
    });
    expect(createW6b2PackagedProofUnexpectedFailure(configuration!)).toEqual({
      errorCode: 'W6B2_FAULT_PROOF_UNEXPECTED',
      faultScenario: 'activeWorkspaceFirstStartFailure',
      formatVersion: 2,
      phase: 'targetFirstStartFailure',
      status: 'failed',
    });
  });
});

async function createProofFiles(input: {
  readonly phase:
    | 'sourceHandoff'
    | 'targetFirstStart'
    | 'switchToB'
    | 'verifyBRestart'
    | 'switchToA'
    | 'rejectC';
  readonly role: 'source' | 'target';
}) {
  const tempPath = await mkdtemp(join(tmpdir(), 'eky-w6b2-config-'));
  temporaryRoots.push(tempPath);
  const root = join(
    tempPath,
    W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
    token.slice(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH),
  );
  const resourcesPath = join(tempPath, 'resources');
  await mkdir(join(root, 'control'), { recursive: true });
  await mkdir(join(resourcesPath, 'backend'), { recursive: true });
  await writeFile(
    join(root, 'control', 'phase.json'),
    `${JSON.stringify({ formatVersion: 1, phase: input.phase })}\n`,
    'utf8',
  );
  await writeFile(
    join(resourcesPath, 'backend', 'w6b2-private-proof-v1.json'),
    `${JSON.stringify({
      appVersion: input.role === 'source' ? '0.2.7' : '0.2.8',
      formatVersion: 1,
      role: input.role,
    })}\n`,
    'utf8',
  );
  const bootstrap = createW6b2PackagedProofBootstrapConfiguration({
    hasProofSwitch: true,
    tempPath,
    tokenValue: token,
  });
  return { bootstrap, resourcesPath, root };
}

async function createFaultProofFiles(input: {
  readonly faultScenario:
    | 'preUpdateRecoveryPointFailure'
    | 'activeWorkspaceFirstStartFailure'
    | 'acceptanceInterruption'
    | 'passiveWorkspaceMigrationFailure'
    | 'binaryRollbackFailure';
  readonly phase:
    | 'sourceHandoff'
    | 'targetFirstStartFailure'
    | 'businessRollback'
    | 'rollbackFirstStart'
    | 'targetAcceptanceInterruption'
    | 'targetAcceptanceRecovery'
    | 'targetAcceptanceRestart'
    | 'targetFirstStart'
    | 'switchToB'
    | 'passiveWorkspaceMigrationFailure'
    | 'passiveWorkspaceRecovery'
    | 'binaryRollbackFailure'
    | 'failedSafeVerification';
  readonly role: 'source' | 'target';
}) {
  const tempPath = await mkdtemp(join(tmpdir(), 'eky-w6b2-fault-config-'));
  temporaryRoots.push(tempPath);
  const root = join(
    tempPath,
    W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
    token.slice(0, W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH),
  );
  const resourcesPath = join(tempPath, 'resources');
  await mkdir(join(root, 'control'), { recursive: true });
  await mkdir(join(resourcesPath, 'backend'), { recursive: true });
  await writeFile(
    join(root, 'control', 'phase.json'),
    `${JSON.stringify({
      faultScenario: input.faultScenario,
      formatVersion: 2,
      phase: input.phase,
    })}\n`,
    'utf8',
  );
  await writeFile(
    join(resourcesPath, 'backend', 'w6b2-private-proof-v1.json'),
    `${JSON.stringify({
      appVersion: input.role === 'source' ? '0.2.7' : '0.2.8',
      formatVersion: 1,
      role: input.role,
    })}\n`,
    'utf8',
  );
  const bootstrap = createW6b2PackagedProofBootstrapConfiguration({
    hasProofSwitch: true,
    tempPath,
    tokenValue: token,
  });
  return { bootstrap, resourcesPath, root };
}
