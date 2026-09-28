import { spawn } from 'node:child_process';
import * as filesystem from 'node:fs';
import { linuxServiceLimits, requireService, serviceFailure } from './linuxServiceContract.mjs';

function output(redactedValues) {
  let pending = Buffer.alloc(0);
  let dropping = false;
  let retained = '';
  const append = line => {
    let text = line.toString('utf8');
    for (const value of redactedValues) text = text.replaceAll(value, '[REDACTED]');
    retained += text;
    while (Buffer.byteLength(retained) > linuxServiceLimits.output) {
      const newline = retained.indexOf('\n');
      retained = newline < 0 ? '' : retained.slice(newline + 1);
    }
  };
  return {
    push(chunk) {
      requireService(Buffer.isBuffer(chunk), 'observationLost');
      for (let offset = 0; offset < chunk.length;) {
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline + 1;
        if (!dropping && pending.length + end - offset <= 8192) {
          pending = Buffer.concat([pending, chunk.subarray(offset, end)]);
        } else { pending = Buffer.alloc(0); dropping = true; }
        if (newline >= 0) {
          if (!dropping) append(pending);
          pending = Buffer.alloc(0); dropping = false;
        }
        offset = end;
      }
    },
    read() { return retained; },
  };
}

function procFile(path, fs) {
  const fd = fs.openSync(path, filesystem.constants.O_RDONLY | filesystem.constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(linuxServiceLimits.proc + 1);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    requireService(length > 0 && length <= linuxServiceLimits.proc, 'observationLost');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
  } finally { fs.closeSync(fd); }
}

export function readLinuxWorkloadIdentity(pid, fs = filesystem) {
  requireService(Number.isSafeInteger(pid) && pid > 1, 'observationLost');
  const stat = procFile(`/proc/${pid}/stat`, fs);
  const end = stat.lastIndexOf(') ');
  requireService(stat.startsWith(`${pid} (`) && end > 0, 'observationLost');
  const fields = stat.slice(end + 2).trim().split(' ');
  requireService(fields.length >= 22 && !['Z', 'X', 'x'].includes(fields[0]) && fields[1] === '1' &&
    /^[1-9][0-9]*$/u.test(fields[19]), 'observationLost');
  return fields[19];
}

// Both proc reads happen inside the PID namespace that owns this direct child.
// Its PID/start tick are private handles, never a host PID or exported receipt.
export function readLinuxWorkloadRss(child, identity, fs = filesystem) {
  requireService(child.exitCode === null && child.signalCode === null &&
    readLinuxWorkloadIdentity(child.pid, fs) === identity, 'observationLost');
  const status = procFile(`/proc/${child.pid}/status`, fs);
  const values = status.split('\n').filter(line => line.startsWith('VmRSS:'));
  requireService(values.length === 1, 'observationLost');
  const match = /^VmRSS:\s+([1-9][0-9]*) kB$/u.exec(values[0]);
  const bytes = match ? Number(match[1]) * 1024 : NaN;
  requireService(Number.isSafeInteger(bytes) && bytes > 0 && child.exitCode === null && child.signalCode === null &&
    readLinuxWorkloadIdentity(child.pid, fs) === identity, 'observationLost');
  return bytes;
}

export function spawnLinuxServiceWorkload(command, redactedValues, onTerminal, {
  spawnChild = spawn, fs = filesystem,
} = {}) {
  const stdout = output(redactedValues);
  const stderr = output(redactedValues);
  let child;
  let state = 'pending';
  let spawned = false;
  let identity;
  let terminal = false;
  let resolveStarted;
  let rejectStarted;
  const started = new Promise((resolve, reject) => { resolveStarted = resolve; rejectStarted = reject; });
  started.catch(() => {});
  const snapshot = (rssBytes = null) => Object.freeze({ state, spawned, stdout: stdout.read(), stderr: stderr.read(), rssBytes });
  const finish = next => {
    if (terminal) return;
    terminal = true; state = next;
    if (!spawned || next === 'unavailable') rejectStarted(serviceFailure('launchFailed'));
    onTerminal(snapshot());
  };
  try {
    child = spawnChild(command.file, command.args, { cwd: command.cwd, env: command.env,
      shell: false, detached: false, stdio: ['ignore', 'pipe', 'pipe'] });
    child.once('spawn', () => {
      if (terminal) return;
      spawned = true;
      try { identity = readLinuxWorkloadIdentity(child.pid, fs); }
      catch { finish('unavailable'); return; }
      state = 'running'; resolveStarted(snapshot());
    });
    child.on('error', () => finish('unavailable'));
    child.once('exit', () => finish('exited'));
    child.once('close', () => { if (!terminal) finish('unavailable'); });
    for (const [name, capture] of [['stdout', stdout], ['stderr', stderr]]) {
      if (!child[name]) { finish('unavailable'); continue; }
      child[name].on('data', chunk => { try { capture.push(chunk); } catch { finish('unavailable'); } });
      child[name].on('error', () => finish('unavailable'));
    }
  } catch { finish('unavailable'); }
  return Object.freeze({ started, snapshot,
    rss() {
      requireService(state === 'running' && !terminal && identity, 'observationLost');
      return snapshot(readLinuxWorkloadRss(child, identity, fs));
    },
  });
}
