import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createW6b2PackagedProfileCommandResult,
  expectedW6b2PackagedProfilePackage,
  parseW6b2PackagedProfileCommandResult,
  parseW6b2PackagedProfileOperation,
  readW6b2PackagedProfileCommandResult,
  resolveW6b2InstalledApplicationPaths,
  w6b2PackagedProfileFailureStages,
  writeW6b2PackagedProfileCommandResult,
} from './w6b2PackagedWorkspaceProfileCommand.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe('W6B.2 packaged workspace profile command', () => {
  it('accepts only the closed operation set', () => {
    expect(parseW6b2PackagedProfileOperation('prepare')).toBe('prepare');
    expect(parseW6b2PackagedProfileOperation('targetFirstStart')).toBe(
      'targetFirstStart',
    );
    expect(() => parseW6b2PackagedProfileOperation('sourceHandoff')).toThrow(
      'W6B2_PROFILE_COMMAND_INVALID',
    );
    expect(() => parseW6b2PackagedProfileOperation('')).toThrow(
      'W6B2_PROFILE_COMMAND_INVALID',
    );
  });

  it('maps every operation to an exact private package identity', () => {
    expect(expectedW6b2PackagedProfilePackage('prepare')).toEqual({
      appVersion: '0.2.7',
      phase: 'sourceHandoff',
      role: 'source',
    });
    expect(expectedW6b2PackagedProfilePackage('verifyBRestart')).toEqual({
      appVersion: '0.2.8',
      phase: 'verifyBRestart',
      role: 'target',
    });
  });

  it('resolves only the fixed canonical per-user installation', async () => {
    const root = await createRoot();
    const applicationPath = join(
      root,
      'Programs',
      'Eky',
      'resources',
      'app.asar',
    );
    await mkdir(join(root, 'Programs', 'Eky', 'resources'), {
      recursive: true,
    });
    await writeFile(applicationPath, 'synthetic asar');

    await expect(resolveW6b2InstalledApplicationPaths(root)).resolves.toEqual({
      applicationPath,
      resourcesPath: join(root, 'Programs', 'Eky', 'resources'),
    });
    await expect(
      resolveW6b2InstalledApplicationPaths(join(root, '..')),
    ).rejects.toThrow('W6B2_PROFILE_COMMAND_INVALID');
  });

  it('rejects an unpacked application directory without app.asar', async () => {
    const root = await createRoot();
    const resourcesPath = join(root, 'Programs', 'Eky', 'resources');
    await mkdir(join(resourcesPath, 'app'), { recursive: true });

    await expect(resolveW6b2InstalledApplicationPaths(root)).rejects.toThrow(
      'W6B2_PROFILE_COMMAND_INVALID',
    );
  });

  it('uses the injected raw filesystem view for the ASAR archive', async () => {
    const root = await createRoot();
    const applicationPath = join(
      root,
      'Programs',
      'Eky',
      'resources',
      'app.asar',
    );
    await mkdir(join(root, 'Programs', 'Eky', 'resources'), {
      recursive: true,
    });
    await writeFile(applicationPath, 'synthetic asar');
    const observedPaths: string[] = [];
    const observedLstat = (async (path: Parameters<typeof lstat>[0]) => {
      observedPaths.push(String(path));
      return await lstat(path);
    }) as typeof lstat;

    await expect(
      resolveW6b2InstalledApplicationPaths(root, {
        lstat: observedLstat,
        realpath,
      }),
    ).resolves.toEqual({
      applicationPath,
      resourcesPath: join(root, 'Programs', 'Eky', 'resources'),
    });
    expect(observedPaths).toContain(applicationPath);
  });

  it('rejects an aliased installation directory', async () => {
    const root = await createRoot();
    const actual = join(root, 'actual');
    const expected = join(root, 'Programs', 'Eky');
    await mkdir(actual, { recursive: true });
    await mkdir(join(root, 'Programs'), { recursive: true });
    await symlink(
      actual,
      expected,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    await expect(resolveW6b2InstalledApplicationPaths(root)).rejects.toThrow(
      'W6B2_PROFILE_COMMAND_INVALID',
    );
  });

  it('writes and reads only the safe strict result DTO', async () => {
    const root = await createRoot();
    const completed = createW6b2PackagedProfileCommandResult({
      operation: 'prepare',
      succeeded: true,
    });
    await writeW6b2PackagedProfileCommandResult(root, completed);
    await expect(readW6b2PackagedProfileCommandResult(root)).resolves.toEqual(
      completed,
    );

    const source = await readFile(
      join(root, 'result', 'w6b2-profile-result.json'),
      'utf8',
    );
    expect(source).not.toContain(root);
    expect(source).not.toContain('stack');
    expect(source).not.toContain('password');
    expect(source).not.toContain('profileId');
  });

  it('preserves only a closed failure stage in failed results', async () => {
    const root = await createRoot();
    const failed = createW6b2PackagedProfileCommandResult({
      failureStage: 'buildIdentity',
      operation: 'prepare',
      succeeded: false,
    });
    await writeW6b2PackagedProfileCommandResult(root, failed);
    await expect(readW6b2PackagedProfileCommandResult(root)).resolves.toEqual(
      failed,
    );
    expect(() =>
      parseW6b2PackagedProfileCommandResult({
        errorCode: 'W6B2_PROFILE_PREPARATION_FAILED',
        failureStage: 'privatePath',
        formatVersion: 1,
        operation: 'prepare',
        status: 'failed',
      }),
    ).toThrow('W6B2_PROFILE_RESULT_INVALID');

    expect(
      parseW6b2PackagedProfileCommandResult({
        errorCode: 'W6B2_PROFILE_PREPARATION_FAILED',
        failureStage: 'electronReady',
        formatVersion: 1,
        operation: 'prepare',
        status: 'failed',
      }),
    ).toEqual({
      errorCode: 'W6B2_PROFILE_PREPARATION_FAILED',
      failureStage: 'electronReady',
      formatVersion: 1,
      operation: 'prepare',
      status: 'failed',
    });

    for (const failureStage of w6b2PackagedProfileFailureStages) {
      expect(
        parseW6b2PackagedProfileCommandResult({
          errorCode: 'W6B2_PROFILE_PREPARATION_FAILED',
          failureStage,
          formatVersion: 1,
          operation: 'prepare',
          status: 'failed',
        }),
      ).toMatchObject({ failureStage });
    }
  });

  it('rejects unknown output keys and mismatched failure codes', () => {
    expect(() =>
      parseW6b2PackagedProfileCommandResult({
        formatVersion: 1,
        operation: 'prepare',
        path: 'private',
        status: 'completed',
      }),
    ).toThrow('W6B2_PROFILE_RESULT_INVALID');
    expect(() =>
      parseW6b2PackagedProfileCommandResult({
        errorCode: 'W6B2_PROFILE_VERIFICATION_FAILED',
        failureStage: 'profileOperation',
        formatVersion: 1,
        operation: 'prepare',
        status: 'failed',
      }),
    ).toThrow('W6B2_PROFILE_RESULT_INVALID');
  });
});

async function createRoot(): Promise<string> {
  const root = resolve(await mkdtemp(join(tmpdir(), 'eky-w6b2-profile-')));
  roots.push(root);
  return root;
}
