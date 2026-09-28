import { encodeLinuxServiceDiagnostic, linuxServiceDiagnosticPrefix }
  from '../experiments/processOwnership/linuxServiceDiagnostic.mjs';
import { encodeServiceProgress } from '../src/environment/serviceProgressDiagnostic.mjs';

export const serviceProgressPrefix = 'EKY_SERVICE_PROGRESS ';
const maximumLineLength = 512;

// Public stdout can split or combine lines. Retain at most one bounded line;
// malformed, extended and oversized records never expose raw diagnostics.
export function createSafeCiOutputRelay(emit) {
  let pending = '';
  let discarding = false;
  return chunk => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : chunk;
    if (typeof text !== 'string') return;
    for (const character of text) {
      if (character !== '\n') {
        if (!discarding) {
          pending += character;
          if (pending.length > maximumLineLength) { pending = ''; discarding = true; }
        }
        continue;
      }
      const line = pending;
      pending = '';
      const dropped = discarding;
      discarding = false;
      if (dropped) continue;
      try {
        if (line.startsWith(linuxServiceDiagnosticPrefix)) {
          emit(encodeLinuxServiceDiagnostic(JSON.parse(line.slice(linuxServiceDiagnosticPrefix.length))));
        } else if (line.startsWith('{')) {
          emit(serviceProgressPrefix + encodeServiceProgress(JSON.parse(line)) + '\n');
        }
      } catch { /* Unknown records remain private. */ }
    }
  };
}
