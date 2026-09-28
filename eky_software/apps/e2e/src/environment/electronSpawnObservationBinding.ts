import type { ChildProcess } from 'node:child_process';
import { isAbsolute } from 'node:path';

import { createWindowsServiceProtocol } from './windowsServiceProtocol.js';

export interface ElectronSpawnObservationBinding {
  readonly executable: string;
  readonly cwd: string;
  readonly generation: string;
  readonly launchNonce: string;
  // The integrating owner chooses the transport names; this observer does not
  // add environment entries or define a second native bridge protocol.
  readonly generationEnvironmentKey: string;
  readonly nonceEnvironmentKey: string;
}

const requireWindowsServiceToken: (value: unknown) => void =
  createWindowsServiceProtocol('electron').requireWindowsServiceToken;

export function validateElectronSpawnObservationBinding(input: ElectronSpawnObservationBinding): void {
  for (const value of [input.executable, input.cwd]) {
    if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0')) throw new Error();
  }
  requireWindowsServiceToken(input.generation);
  requireWindowsServiceToken(input.launchNonce);
  const keys = [input.generationEnvironmentKey, input.nonceEnvironmentKey];
  if (keys.some(key => typeof key !== 'string' || !/^[A-Z_][A-Z0-9_]*$/.test(key)) ||
    keys[0] === keys[1]) throw new Error();
}

export function matchesElectronSpawnObservation(
  child: ChildProcess, value: unknown, expected: ElectronSpawnObservationBinding,
): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const options = value as Record<string, unknown>;
  const pairs = options.envPairs;
  if (child.spawnfile !== expected.executable || options.file !== expected.executable ||
    options.cwd !== expected.cwd || !Array.isArray(pairs)) return false;
  for (const [key, expectedValue] of [
    [expected.generationEnvironmentKey, expected.generation],
    [expected.nonceEnvironmentKey, expected.launchNonce],
  ] as const) {
    let count = 0;
    for (const pair of pairs as unknown[]) {
      if (typeof pair !== 'string') return false;
      const separator = pair.indexOf('=');
      // Reject duplicate/case-variant identity keys even on a case-sensitive host.
      if (pair.slice(0, separator).toUpperCase() !== key) continue;
      if (pair !== `${key}=${expectedValue}`) return false;
      count += 1;
    }
    if (count !== 1) return false;
  }
  return true;
}
