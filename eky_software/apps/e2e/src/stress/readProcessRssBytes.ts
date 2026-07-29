import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

const commandTimeoutMilliseconds = 10_000;

export async function readProcessRssBytes(pid: number): Promise<number> {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new Error('Process id must be a positive safe integer.');
  }

  if (process.platform === 'linux') {
    const status = await readFile(`/proc/${String(pid)}/status`, 'utf8');
    const match = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status);
    if (match?.[1] === undefined) {
      throw new Error('Backend RSS was not available from procfs.');
    }
    return Number(match[1]) * 1024;
  }

  if (process.platform === 'win32') {
    const output = await executeTextCommand('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-Process -Id ${String(pid)} -ErrorAction Stop).WorkingSet64`,
    ]);
    return parsePositiveByteCount(output);
  }

  const output = await executeTextCommand('ps', [
    '-o',
    'rss=',
    '-p',
    String(pid),
  ]);
  return parsePositiveByteCount(output) * 1024;
}

function executeTextCommand(
  command: string,
  args: readonly string[],
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      {
        encoding: 'utf8',
        timeout: commandTimeoutMilliseconds,
        windowsHide: true,
      },
      (error, stdout) => {
        if (error !== null) {
          reject(new Error('Backend RSS measurement failed.'));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parsePositiveByteCount(value: string): number {
  const bytes = Number(value.trim());
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new Error('Backend RSS measurement returned an invalid value.');
  }
  return bytes;
}
