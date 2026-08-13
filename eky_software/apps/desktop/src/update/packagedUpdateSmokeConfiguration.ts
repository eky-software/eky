import { realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const packagedUpdateSmokePhases = Object.freeze([
  'seed',
  'prepareSuccess',
  'verifySuccess',
  'prepareCancel',
  'verifyCancel',
  'prepareFailure',
  'verifyRollback',
  'verifyDirectSuccess',
  'verifyDirectFailure',
  'createBackup',
  'restoreBackup',
  'verifyBackup',
] as const);

export type PackagedUpdateSmokePhase =
  (typeof packagedUpdateSmokePhases)[number];

export interface PackagedUpdateSmokeConfiguration {
  enabled: boolean;
  phase: PackagedUpdateSmokePhase | undefined;
  root: string | undefined;
  userDataPath: string | undefined;
}

const expectedRecoveryRelaunchPhases = new Set<PackagedUpdateSmokePhase>([
  'verifyBackup',
  'verifyDirectFailure',
  'verifyRollback',
]);

export interface PackagedUpdateSmokeRecoveryReport {
  action: 'quit' | 'relaunch';
  errorCode:
    | 'DESKTOP_UPDATE_SMOKE_EXPECTED_RECOVERY_REQUIRED'
    | 'DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED';
}

export function resolvePackagedUpdateSmokeRecoveryReport(
  configuration: Readonly<PackagedUpdateSmokeConfiguration>,
): PackagedUpdateSmokeRecoveryReport | undefined {
  if (!configuration.enabled || configuration.phase === undefined) {
    return undefined;
  }
  return expectedRecoveryRelaunchPhases.has(configuration.phase)
    ? Object.freeze({
        action: 'relaunch',
        errorCode: 'DESKTOP_UPDATE_SMOKE_EXPECTED_RECOVERY_REQUIRED',
      })
    : Object.freeze({
        action: 'quit',
        errorCode: 'DESKTOP_UPDATE_SMOKE_UNEXPECTED_RECOVERY_REQUIRED',
      });
}

const smokeTokenPattern = /^[0-9a-f]{32}$/;

export function createPackagedUpdateSmokeConfiguration(input: {
  phaseValue: string;
  tempPath: string;
  tokenValue: string | undefined;
}): PackagedUpdateSmokeConfiguration {
  if (input.phaseValue === '') {
    return Object.freeze({
      enabled: false,
      phase: undefined,
      root: undefined,
      userDataPath: undefined,
    });
  }

  const phase = readPackagedUpdateSmokePhase(input.phaseValue);
  const token = readPackagedUpdateSmokeToken(input.tokenValue);
  const root = join(
    resolvePackagedUpdateSmokeTempPath(input.tempPath),
    'eky-desktop-update-smoke',
    token,
  );

  return Object.freeze({
    enabled: true,
    phase,
    root,
    userDataPath: join(root, 'user-data'),
  });
}

export function resolvePackagedUpdateSmokeTempPath(tempPath: string): string {
  try {
    return realpathSync.native(resolve(tempPath));
  } catch {
    throw new Error('DESKTOP_UPDATE_SMOKE_PATH_INVALID');
  }
}

function readPackagedUpdateSmokePhase(
  value: string,
): PackagedUpdateSmokePhase {
  const phase = packagedUpdateSmokePhases.find(
    (candidate) => candidate === value,
  );
  if (phase === undefined) {
    throw new Error('DESKTOP_UPDATE_SMOKE_PHASE_INVALID');
  }
  return phase;
}

function readPackagedUpdateSmokeToken(value: string | undefined): string {
  if (value === undefined || !smokeTokenPattern.test(value)) {
    throw new Error('DESKTOP_UPDATE_SMOKE_TOKEN_INVALID');
  }
  return value;
}
