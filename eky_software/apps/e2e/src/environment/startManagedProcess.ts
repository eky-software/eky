import { spawn, type ChildProcess } from 'node:child_process';

import { createBoundedProcessOutput, defaultProcessOutputLimitBytes, type ProcessOutput } from './boundedProcessOutput.js';

export type ManagedChildProcess = ChildProcess & {
  on(event: 'exit', listener: () => void): ManagedChildProcess;
};

export interface ManagedProcess extends ProcessOutput {
  child: ManagedChildProcess;
}

export function startManagedProcess(input: {
  args: readonly string[];
  command: string;
  cwd: string;
  environment: Readonly<Record<string, string | undefined>>;
  inheritEnvironment?: boolean;
  outputLimitBytes?: number;
  redactedValues?: readonly string[];
}): ManagedProcess {
  const outputLimitBytes = input.outputLimitBytes ?? defaultProcessOutputLimitBytes;
  const stdout = createBoundedProcessOutput(outputLimitBytes, input.redactedValues);
  const stderr = createBoundedProcessOutput(outputLimitBytes, input.redactedValues);
  const child = spawn(input.command, input.args, {
    cwd: input.cwd,
    detached: process.platform !== 'win32',
    env: {
      ...(input.inheritEnvironment === false ? {} : process.env),
      ...input.environment,
    },
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  child.stdout?.on('data', (chunk: Buffer) => {
    stdout.append(chunk);
  });
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr.append(chunk);
  });

  return {
    child: child as ManagedChildProcess,
    readStderr: stderr.read,
    readStdout: stdout.read,
  };
}
