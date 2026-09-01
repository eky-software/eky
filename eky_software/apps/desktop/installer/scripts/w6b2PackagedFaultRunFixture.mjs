import { lstat, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  createW6b2PackagedSuccessRunFixture,
  removeW6b2PackagedSuccessRunFixture,
  verifyW6b2PackagedSuccessRunFixture,
} from './w6b2PackagedSuccessRunFixture.mjs';

export const w6b2PackagedFaultScenarios = Object.freeze([
  'preUpdateRecoveryPointFailure',
  'activeWorkspaceFirstStartFailure',
  'acceptanceInterruption',
  'passiveWorkspaceMigrationFailure',
  'binaryRollbackFailure',
]);

const allowedPhases = Object.freeze({
  preUpdateRecoveryPointFailure: new Set(['sourceHandoff']),
  activeWorkspaceFirstStartFailure: new Set([
    'sourceHandoff',
    'targetFirstStartFailure',
    'businessRollback',
    'rollbackFirstStart',
  ]),
  acceptanceInterruption: new Set([
    'sourceHandoff',
    'targetAcceptanceInterruption',
    'targetAcceptanceRecovery',
    'targetAcceptanceRestart',
  ]),
  passiveWorkspaceMigrationFailure: new Set([
    'sourceHandoff',
    'targetFirstStart',
    'switchToB',
    'passiveWorkspaceMigrationFailure',
    'passiveWorkspaceRecovery',
  ]),
  binaryRollbackFailure: new Set([
    'sourceHandoff',
    'targetFirstStartFailure',
    'businessRollback',
    'binaryRollbackFailure',
    'failedSafeVerification',
  ]),
});

export async function createW6b2PackagedFaultRunFixture(input) {
  requireFaultScenario(input.faultScenario);
  const run = await createW6b2PackagedSuccessRunFixture(input);
  try {
    await writeW6b2PackagedFaultPhase({
      faultScenario: input.faultScenario,
      phase: 'sourceHandoff',
      proofRoot: run.proofRoot,
    });
    return Object.freeze({ ...run, faultScenario: input.faultScenario });
  } catch (error) {
    await removeW6b2PackagedSuccessRunFixture({
      proofRoot: run.proofRoot,
      temporaryRoot: input.temporaryRoot,
      token: run.token,
    }).catch(() => undefined);
    throw error;
  }
}

export async function writeW6b2PackagedFaultPhase(input) {
  requireFaultPhase(input.faultScenario, input.phase);
  const proofRoot = resolve(input.proofRoot);
  const controlRoot = join(proofRoot, 'control');
  const metadata = await lstat(controlRoot);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error('W6B2_FAULT_CONTROL_INVALID');
  }
  const phasePath = join(controlRoot, 'phase.json');
  const nextPath = join(controlRoot, 'phase.next.json');
  await rm(nextPath, { force: true });
  try {
    await writeFile(
      nextPath,
      `${JSON.stringify({
        faultScenario: input.faultScenario,
        formatVersion: 2,
        phase: input.phase,
      })}\n`,
      { encoding: 'utf8', flag: 'wx', mode: 0o600 },
    );
    await rm(phasePath, { force: true });
    await rename(nextPath, phasePath);
  } finally {
    await rm(nextPath, { force: true });
  }
}

export async function verifyW6b2PackagedFaultRunFixture(input) {
  requireFaultScenario(input.faultScenario);
  await verifyW6b2PackagedSuccessRunFixture(input);
  const control = JSON.parse(
    await readFile(join(input.proofRoot, 'control', 'phase.json'), 'utf8'),
  );
  if (
    !isRecord(control) ||
    !hasExactKeys(control, ['faultScenario', 'formatVersion', 'phase'])
  ) {
    throw new Error('W6B2_FAULT_CONTROL_INVALID');
  }
  requireFaultPhase(control.faultScenario, control.phase);
  if (control.formatVersion !== 2 || control.faultScenario !== input.faultScenario) {
    throw new Error('W6B2_FAULT_CONTROL_INVALID');
  }
}

export const removeW6b2PackagedFaultRunFixture =
  removeW6b2PackagedSuccessRunFixture;

export function requireW6b2PackagedFaultScenario(value) {
  requireFaultScenario(value);
  return value;
}

function requireFaultScenario(value) {
  if (!w6b2PackagedFaultScenarios.includes(value)) {
    throw new Error('W6B2_FAULT_SCENARIO_INVALID');
  }
}

function requireFaultPhase(scenario, phase) {
  requireFaultScenario(scenario);
  if (typeof phase !== 'string' || !allowedPhases[scenario].has(phase)) {
    throw new Error('W6B2_FAULT_PHASE_INVALID');
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasExactKeys(value, expected) {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}
