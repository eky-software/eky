import { closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';

import {
  firstStartProofObservationPath,
  MAX_FIRST_START_PROOF_OBSERVATION_BYTES,
  parseFirstStartProofObservations,
  type FirstStartProofCapture,
} from '../../../desktop/e2e/workspaceFirstStartProofObservation.js';

// Read only the fixed file in the fixture-owned runtime, after process cleanup
// and before root removal. No Electron evaluation is needed at timeout.
export function captureFirstStartProof(userDataRoot: string, runtimeInstanceId: string): FirstStartProofCapture {
  let descriptor: number | undefined;
  try {
    const path = firstStartProofObservationPath(userDataRoot, runtimeInstanceId);
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
      return { status: 'invalid' };
    }
    descriptor = openSync(path, 'r');
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.nlink !== 1 ||
        before.ino !== opened.ino || before.dev !== opened.dev) {
      return { status: 'invalid' };
    }
    if (opened.size > MAX_FIRST_START_PROOF_OBSERVATION_BYTES) return { status: 'tooLarge' };
    const buffer = Buffer.alloc(MAX_FIRST_START_PROOF_OBSERVATION_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const read = readSync(descriptor, buffer, bytes, buffer.length - bytes, null);
      if (read === 0) break;
      bytes += read;
    }
    if (bytes > MAX_FIRST_START_PROOF_OBSERVATION_BYTES) return { status: 'tooLarge' };
    return parseFirstStartProofObservations(buffer.subarray(0, bytes).toString('utf8'));
  } catch (error) {
    return { status: descriptor === undefined && hasCode(error, 'ENOENT') ? 'missing' : 'readFailed' };
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor); } catch { /* Preserve the captured diagnostic. */ }
    }
  }
}

function hasCode(value: unknown, code: string): boolean {
  return value instanceof Error && 'code' in value && value.code === code;
}
