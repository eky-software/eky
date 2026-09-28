import { streamLimit } from './adapterContract.mjs';

// Private retained diagnostics only; never a readiness or terminal receipt.
export function boundedFailureDetails(error) {
  for (const read of [() => error?.stack, () => error?.message, () => String(error)]) {
    try {
      const value = read();
      if (typeof value === 'string' && value.trim())
        return Buffer.from(value).subarray(0, streamLimit);
    } catch { /* A broken error formatter must not erase the failure observation. */ }
  }
  return Buffer.from('Failure without printable details');
}

export function observeBoundedChildOutput(child) {
  let output = Buffer.alloc(0);
  let failure;
  let rejectFailure;
  const failed = new Promise((_resolve, reject) => { rejectFailure = reject; });
  failed.catch(() => {});
  const fail = error => {
    if (failure) return;
    failure = error;
    rejectFailure(error);
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('error', fail);
    stream?.on('data', chunk => {
      const remaining = streamLimit - output.length;
      output = Buffer.concat([output, chunk.subarray(0, remaining)]);
      if (chunk.length > remaining) fail(new Error('childOutputOverflow'));
    });
  }
  return {
    get output() { return Buffer.from(output); },
    get failure() { return failure; },
    failed,
    assertHealthy() { if (failure) throw failure; },
    async guard(operation) {
      // The caller retains the deadline and cleanup owner, including after rejection.
      operation = Promise.resolve(operation);
      operation.catch(() => {});
      if (failure) throw failure;
      const result = await Promise.race([operation, failed]);
      if (failure) throw failure;
      return result;
    },
  };
}
