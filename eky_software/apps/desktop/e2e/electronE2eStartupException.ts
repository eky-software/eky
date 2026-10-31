import { dirname, join } from 'node:path';

import { readElectronE2eConfig, type ElectronE2eConfig } from './electronE2eConfig.js';
import { createStartupExceptionDelivery, projectExceptionChain, validateExceptionProjection,
  type ExceptionProjection, type StartupExceptionCapture, type StartupExceptionStage } from '../src/main/startupExceptionEvidence.js';

const stages = ['earlyStartup', 'compositionStartup', 'runtimeStartup'] as const;
export interface ElectronE2eStartupException {
  schemaVersion: 1;
  runtimeInstanceId: string;
  stage: typeof stages[number];
  exception: ExceptionProjection;
}

export function electronE2eStartupExceptionPath(artifactsRoot: string, runtimeInstanceId: string): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(runtimeInstanceId)) {
    throw new Error('ELECTRON_E2E_STARTUP_EXCEPTION_INVALID');
  }
  return join(artifactsRoot, `${runtimeInstanceId}.startup-exception.private.json`);
}

export function validateElectronE2eStartupException(value: unknown, runtimeInstanceId: string): ElectronE2eStartupException {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const record = value as Record<string, unknown>;
  const keys = ['schemaVersion', 'runtimeInstanceId', 'stage', 'exception'];
  if (Object.keys(record).length !== keys.length || !keys.every(key => Object.hasOwn(record, key)) ||
    record.schemaVersion !== 1 || record.runtimeInstanceId !== runtimeInstanceId ||
    !stages.includes(record.stage as typeof stages[number])) invalid();
  return { schemaVersion: 1, runtimeInstanceId, stage: record.stage as typeof stages[number],
    exception: validateExceptionProjection(record.exception) };
}

// Re-read through the existing admission guard. No packaged opt-in/profile/build
// rule is relaxed to accept the development runtime's synthetic build identity.
export function createElectronE2eStartupExceptionCapture(configPath: string,
  environment: Readonly<Record<string, string | undefined>> = process.env): StartupExceptionCapture | undefined {
  try {
    const config: ElectronE2eConfig = readElectronE2eConfig(configPath, environment);
    return createStartupExceptionDelivery({
      output: electronE2eStartupExceptionPath(dirname(config.paths.observationsPath), config.runtimeInstanceId),
      project(error: unknown, stage: StartupExceptionStage, secrets: readonly string[]) {
        return validateElectronE2eStartupException({ schemaVersion: 1, runtimeInstanceId: config.runtimeInstanceId, stage,
          exception: projectExceptionChain(error, [...secrets, config.backend.sessionSecret]) }, config.runtimeInstanceId);
      },
    });
  } catch { return undefined; }
}

function invalid(): never { throw new Error('ELECTRON_E2E_STARTUP_EXCEPTION_INVALID'); }
