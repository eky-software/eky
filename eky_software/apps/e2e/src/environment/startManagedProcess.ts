import { spawn, type ChildProcess } from 'node:child_process';

const defaultOutputLimitBytes = 256 * 1024;

export interface ManagedProcess {
  child: ChildProcess;
  readStderr(): string;
  readStdout(): string;
}

export function startManagedProcess(input: {
  args: readonly string[];
  command: string;
  cwd: string;
  environment: Readonly<Record<string, string | undefined>>;
  outputLimitBytes?: number;
  redactedValues?: readonly string[];
}): ManagedProcess {
  const outputLimitBytes = input.outputLimitBytes ?? defaultOutputLimitBytes;
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    detached: process.platform !== 'win32',
    env: {
      ...process.env,
      ...input.environment,
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  const stdout = createBoundedOutput(outputLimitBytes, input.redactedValues);
  const stderr = createBoundedOutput(outputLimitBytes, input.redactedValues);
  child.stdout?.on('data', (chunk: Buffer) => {
    stdout.append(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.append(chunk);
  });

  return {
    child,
    readStderr: stderr.read,
    readStdout: stdout.read,
  };
}

function createBoundedOutput(
  limitBytes: number,
  redactedValues: readonly string[] = [],
): {
  append(chunk: Buffer): void;
  read(): string;
} {
  let output = Buffer.alloc(0);

  return {
    append(chunk) {
      output = Buffer.concat([output, chunk]).subarray(-limitBytes);
    },
    read() {
      let text = output.toString('utf8');
      for (const value of redactedValues) {
        if (value !== '') {
          text = text.replaceAll(value, '[REDACTED]');
        }
      }
      return text;
    },
  };
}
