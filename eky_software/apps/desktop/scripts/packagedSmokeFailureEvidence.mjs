const MAX_STREAM_BYTES = 64 * 1024;

// Memory-only observation; the smoke owner still owns exit, timeout and cleanup.
export function observeSmokeOutput(child, phase) {
  const streams = {};
  for (const name of ['stdout', 'stderr']) {
    const stream = child[name];
    let bytes = Buffer.alloc(0);
    let truncated = false;
    let readFailed = false;
    let ended = stream?.readableEnded === true;
    stream?.on('data', chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const available = MAX_STREAM_BYTES - bytes.length;
      if (buffer.length > available) truncated = true;
      bytes = Buffer.concat([bytes, buffer.subarray(0, available)]);
    });
    stream?.on('end', () => { ended = true; });
    stream?.on('error', () => { readFailed = true; });
    streams[name] = () => {
      const available = stream != null;
      const changed = child[name] !== stream;
      return { text: bytes.toString('utf8'), truncated, readFailed, available, ended, changed,
        partial: !available || !ended || changed || truncated || readFailed };
    };
  }
  return () => ({ phase, stdout: streams.stdout(), stderr: streams.stderr() });
}
