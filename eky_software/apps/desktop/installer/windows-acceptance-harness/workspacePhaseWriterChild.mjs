import { writeSync } from 'node:fs';
import {
  encodeWorkspacePhaseObservation, parseWorkspacePhaseObservation, WORKSPACE_PHASE_MAX_BYTES,
} from './workspacePhaseObservation.mjs';

// This leaf alone may block in the destination's native write. Its existing
// direct-process adapter owns termination; it has no scenario capabilities.
let pending = Buffer.alloc(0);
try {
  if (process.argv.length !== 2) throw new Error();
  for await (const chunk of process.stdin) {
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline + 1;
      const length = end - start;
      if (pending.length + length > WORKSPACE_PHASE_MAX_BYTES) throw new Error();
      pending = Buffer.concat([pending, chunk.subarray(start, end)]);
      start = end;
      if (newline < 0) break;
      const bytes = encodeWorkspacePhaseObservation(parseWorkspacePhaseObservation(pending));
      let written = 0;
      while (written < bytes.length) {
        const count = writeSync(1, bytes, written, bytes.length - written);
        if (count <= 0) throw new Error();
        written += count;
      }
      pending = Buffer.alloc(0);
    }
  }
  if (pending.length !== 0) throw new Error();
} catch {
  process.stdin.destroy();
  process.exitCode = 1;
}
