import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createPackagedUpdateSmokeConfiguration,
  resolvePackagedUpdateSmokeRecoveryReport,
  resolvePackagedUpdateSmokeRollbackProgressPath,
  type PackagedUpdateSmokePhase,
} from './packagedUpdateSmokeConfiguration.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('packaged update smoke configuration', () => {
  it('stays disabled without the private command-line phase', () => {
    const configuration = createPackagedUpdateSmokeConfiguration({
      phaseValue: '',
      tempPath: tmpdir(),
      tokenValue: undefined,
    });

    expect(configuration).toEqual({
      enabled: false,
      phase: undefined,
      root: undefined,
      userDataPath: undefined,
    });
  });

  it('derives a contained main-process root from a strict token', () => {
    const tempPath = createTemporaryDirectory();
    const token = '0123456789abcdef0123456789abcdef';
    const configuration = createPackagedUpdateSmokeConfiguration({
      phaseValue: 'prepareSuccess',
      tempPath,
      tokenValue: token,
    });
    const expectedRoot = join(
      realpathSync.native(tempPath),
      'eky-desktop-update-smoke',
      token,
    );

    expect(configuration).toEqual({
      enabled: true,
      phase: 'prepareSuccess',
      root: expectedRoot,
      userDataPath: join(expectedRoot, 'user-data'),
    });
    expect(resolvePackagedUpdateSmokeRollbackProgressPath(configuration)).toBe(
      join(expectedRoot, 'result', 'rollback-installer-progress.jsonl'),
    );
  });

  it.each([
    ['unknown', '0123456789abcdef0123456789abcdef'],
    ['seed', undefined],
    ['seed', '0123456789ABCDEF0123456789ABCDEF'],
    ['seed', '../0123456789abcdef0123456789abcd'],
  ])('rejects an invalid phase or token', (phaseValue, tokenValue) => {
    const tempPath = createTemporaryDirectory();

    expect(() =>
      createPackagedUpdateSmokeConfiguration({
        phaseValue,
        tempPath,
        tokenValue,
      }),
    ).toThrow();
  });

  it('reports recovery during a success-path verification', () => {
    expect(
      resolvePackagedUpdateSmokeRecoveryReport(
        createConfiguration('verifySuccess'),
      ),
    ).toEqual({
      action: 'quit',
      errorCode: 'DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED',
    });
  });

  it.each(['verifyBackup', 'verifyDirectFailure', 'verifyRollback'] as const)(
    'allows the bounded recovery sequence for %s',
    (phase) => {
      expect(
        resolvePackagedUpdateSmokeRecoveryReport(
          createConfiguration(phase),
        ),
      ).toEqual({
        action: 'relaunch',
        errorCode: 'DESKTOP_UPDATE_SMOKE_EXPECTED_RECOVERY_REQUIRED',
      });
    },
  );

  it('does not classify disabled automation as a smoke failure', () => {
    expect(
      resolvePackagedUpdateSmokeRecoveryReport({
        enabled: false,
        phase: undefined,
        root: undefined,
        userDataPath: undefined,
      }),
    ).toBeUndefined();
    expect(
      resolvePackagedUpdateSmokeRollbackProgressPath({
        enabled: false,
        phase: undefined,
        root: undefined,
        userDataPath: undefined,
      }),
    ).toBeUndefined();
  });
});

function createConfiguration(phase: PackagedUpdateSmokePhase) {
  return createPackagedUpdateSmokeConfiguration({
    phaseValue: phase,
    tempPath: createTemporaryDirectory(),
    tokenValue: 'a'.repeat(32),
  });
}

function createTemporaryDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), 'eky-update-smoke-config-'));
  mkdirSync(root, { recursive: true });
  temporaryRoots.push(root);
  return root;
}
