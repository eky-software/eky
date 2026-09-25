import { constants } from 'node:fs';
import * as filesystem from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  deadlineMilliseconds, maximumReadBytes, parseCgroupEvents, parseCgroupType,
  parseProbeContext, PrerequisiteFailure, resolveOwnCgroup,
  serializePrerequisiteResult, unknownObservation,
} from './linuxPrerequisiteContract.mjs';

const ownCgroupFile = '/proc/self/cgroup';
const ownMountinfoFile = '/proc/self/mountinfo';
const clock = {
  now: () => performance.now(),
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: timer => clearTimeout(timer),
};

function safeReason(error) {
  return error instanceof PrerequisiteFailure ? error.reason : 'readFailed';
}

async function readBounded(fs, path, check, optional = false) {
  let handle;
  let failure;
  try {
    check();
    handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    check();
    const metadata = await handle.stat();
    check();
    if (!metadata.isFile()) throw new PrerequisiteFailure('invalidMetadata');
    const buffer = Buffer.alloc(maximumReadBytes);
    let used = 0;
    while (used < buffer.length) {
      check();
      const length = buffer.length - used;
      const { bytesRead } = await handle.read(buffer, used, length, null);
      check();
      if (!Number.isInteger(bytesRead) || bytesRead < 0 || bytesRead > length) {
        throw new PrerequisiteFailure('invalidMetadata');
      }
      if (bytesRead === 0) return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, used));
      used += bytesRead;
    }
    // Saturation has no proven EOF. Do not read an extra byte beyond the budget.
    throw new PrerequisiteFailure('readLimitExceeded');
  } catch (error) {
    if (!handle && optional && error?.code === 'ENOENT') return null;
    failure = new PrerequisiteFailure(safeReason(error));
    throw failure;
  } finally {
    if (handle) {
      try { await handle.close(); }
      catch (error) { if (!failure) throw error; }
    }
  }
}

async function metadata(fs, path, check, directory = false) {
  check();
  try {
    const result = await fs.lstat(path);
    check();
    if (!(directory ? result.isDirectory() : result.isFile()) || result.isSymbolicLink()) {
      throw new PrerequisiteFailure('invalidMetadata');
    }
    return true;
  } catch (error) {
    if (!directory && error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function accessHint(fs, path, check, mountMode, directory = false) {
  check();
  try {
    await fs.access(path, constants.W_OK | (directory ? constants.X_OK : 0));
    check();
    return mountMode === 'ro' ? 'denied' : 'allowed';
  } catch (error) {
    check();
    if (['EACCES', 'EPERM', 'EROFS'].includes(error?.code)) return 'denied';
    throw error;
  }
}

async function observe(binding, fs, check) {
  const own = await readBounded(fs, ownCgroupFile, check);
  const mountinfo = await readBounded(fs, ownMountinfoFile, check);
  check();
  const mapping = resolveOwnCgroup(own, mountinfo);
  const result = unknownObservation(binding);
  if (mapping.cgroupV2 === 'absent') {
    return { ...result, observation: 'complete', reason: 'v2Absent', cgroupV2: 'absent' };
  }
  const { target, mountMode } = mapping;
  await metadata(fs, target, check, true);
  const type = await readBounded(fs, posix.join(target, 'cgroup.type'), check, true);
  const events = await readBounded(fs, posix.join(target, 'cgroup.events'), check, true);
  const killPath = posix.join(target, 'cgroup.kill');
  const procsPath = posix.join(target, 'cgroup.procs');
  // Only lstat/access on procs and kill: neither file is ever opened or read.
  const killPresent = await metadata(fs, killPath, check);
  const procsPresent = await metadata(fs, procsPath, check);
  const createChild = await accessHint(fs, target, check, mountMode, true);
  const writeProcs = procsPresent ? await accessHint(fs, procsPath, check, mountMode) : 'unknown';
  const writeKill = killPresent ? await accessHint(fs, killPath, check, mountMode) : 'unknown';
  check();
  return {
    ...result, observation: 'complete', reason: 'observed', cgroupV2: 'mapped',
    cgroupType: type === null ? 'absent' : parseCgroupType(type), mountMode,
    events: events === null ? 'absent' : parseCgroupEvents(events),
    killAvailability: killPresent ? 'present' : 'absent',
    accessHints: { createChild, writeProcs, writeKill },
  };
}

// The CLI owns the deadline and process exit, including pending FS and stdout work.
// Tests inject every host-facing operation; importing this module never probes.
export function runLinuxPrerequisiteCli({
  argv, environment, platform, fs = filesystem, time = clock,
  writeLine = (line, done) => process.stdout.write(line, done),
  exit = code => process.exit(code),
}) {
  const started = time.now();
  let binding = null;
  let published = false;
  let ended = false;
  let timer;
  return new Promise(resolve => {
    function end(code) {
      if (ended) return;
      if (code === 0 && time.now() - started >= deadlineMilliseconds) code = 1;
      ended = true;
      time.clearTimeout(timer);
      try { exit(code); } finally { resolve(code); }
    }
    function check() {
      if (ended || time.now() - started >= deadlineMilliseconds) {
        throw new PrerequisiteFailure('deadlineExceeded');
      }
    }
    function publish(value, force = false) {
      if (ended) return;
      if (!published) {
        let line;
        try { line = serializePrerequisiteResult(value, binding); }
        catch { line = serializePrerequisiteResult(unknownObservation(binding), binding); }
        published = true;
        const code = JSON.parse(line).observation === 'complete' ? 0 : 1;
        try { writeLine(line, error => end(error ? 1 : code)); }
        catch { end(1); }
      }
      if (force) end(1);
    }
    timer = time.setTimeout(() => {
      publish(unknownObservation(binding, 'deadlineExceeded'), true);
    }, Math.max(0, deadlineMilliseconds - (time.now() - started)));
    void (async () => {
      try {
        binding = parseProbeContext(argv, environment);
        if (!binding) return publish(unknownObservation());
        check();
        if (platform !== 'linux') return publish(unknownObservation(binding, 'notLinux'));
        const result = await observe(binding, fs, check);
        check();
        publish(result);
      } catch (error) {
        publish(unknownObservation(binding, safeReason(error)));
      }
    })();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.on('error', () => process.exit(1));
  await runLinuxPrerequisiteCli({
    argv: process.argv.slice(2), environment: process.env, platform: process.platform,
  });
}
