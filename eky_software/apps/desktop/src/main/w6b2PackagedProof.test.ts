import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createW6b2PackagedProofBootstrapConfiguration,
  parseW6b2PackagedProofResult,
  readW6b2PackagedProofConfiguration,
  W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
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
  const root = join(tempPath, W6B2_PACKAGED_PROOF_DIRECTORY_NAME, token);
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
