export const defaultProcessOutputLimitBytes = 256 * 1024;

export interface ProcessOutput {
  readStderr(): string;
  readStdout(): string;
}

export function createBoundedProcessOutput(
  limitBytes = defaultProcessOutputLimitBytes,
  redactedValues: readonly string[] = [],
): { append(chunk: Buffer): void; read(): string } {
  if (!Number.isSafeInteger(limitBytes) || limitBytes <= 0) {
    throw new Error('E2E_PROCESS_OUTPUT_LIMIT_INVALID');
  }
  let output = Buffer.alloc(0);
  return {
    append(chunk) { output = Buffer.concat([output, chunk]).subarray(-limitBytes); },
    read() {
      let text = output.toString('utf8');
      for (const value of redactedValues) {
        if (value !== '') text = text.replaceAll(value, '[REDACTED]');
      }
      return text;
    },
  };
}
