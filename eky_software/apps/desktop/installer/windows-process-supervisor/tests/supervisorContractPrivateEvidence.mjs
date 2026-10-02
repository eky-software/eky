import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const CONTRACT_OUTPUT_LIMIT = 65_536;
const MAX_CAPTURES = 16;

// Only streams already consumed by the contract are observed. No file I/O
// or delivery acknowledgement is added to the running supervisor's path.
export function captureContractOutput(context, mode) {
  context.privateOutputCaptures ??= [];
  const capture = {
    mode, closed: false,
    stdout: { bytes: Buffer.alloc(0), truncated: false, ended: false },
    stderr: { bytes: Buffer.alloc(0), truncated: false, ended: false },
  };
  const retained = context.privateOutputCaptures.length < MAX_CAPTURES;
  if (retained) context.privateOutputCaptures.push(capture);
  else context.privateOutputOverflow = true;
  return {
    append(stream, chunk) {
      if (!retained || mode !== 'observed') return;
      const output = capture[stream];
      const bytes = Buffer.from(chunk, 'utf8');
      const remaining = CONTRACT_OUTPUT_LIMIT - output.bytes.length;
      output.truncated ||= bytes.length > remaining;
      if (remaining > 0) output.bytes = Buffer.concat([output.bytes, bytes.subarray(0, remaining)]);
    },
    end(stream) { capture[stream].ended = true; },
    close() { capture.closed = true; },
  };
}

// Called after the existing cleanup attempts, before any root removal. These
// private files are not public test attachments; the collector must allowlist
// their exact names and encrypt them. Existing result files stay in place.
export async function preserveContractOutput(context) {
  if (!context.privateOutputCaptures?.length || context.privateOutputRetention) return;
  context.privateOutputRetention = 'partial';
  const captures = [];
  let complete = !context.privateOutputOverflow;
  for (const [index, capture] of context.privateOutputCaptures.entries()) {
    const record = { invocation: index + 1, mode: capture.mode, closed: capture.closed };
    for (const stream of ['stdout', 'stderr']) {
      const output = capture[stream];
      record[stream] = {
        status: capture.mode === 'observed' ? 'unavailable' : 'notRead',
        bytes: output.bytes.length, truncated: output.truncated, ended: output.ended,
      };
      if (capture.mode !== 'observed') continue;
      try {
        await writeFile(join(context.testRoot, `supervisor-${index + 1}.${stream}.private`), output.bytes,
          { flag: 'wx', mode: 0o600 });
        record[stream].status = 'retained';
      } catch { complete = false; }
    }
    captures.push(record);
  }
  try {
    await writeFile(join(context.testRoot, 'supervisor-output.private.json'),
      JSON.stringify({ schemaVersion: 1, invocationLimit: MAX_CAPTURES,
        invocationOverflow: context.privateOutputOverflow === true, captures }) + '\n',
      { flag: 'wx', mode: 0o600 });
    context.privateOutputRetention = complete ? 'retained' : 'partial';
  } catch { /* Never replace the contract or cleanup failure with a write error. */ }
}
