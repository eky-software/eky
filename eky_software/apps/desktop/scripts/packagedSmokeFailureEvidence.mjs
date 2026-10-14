import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createStartupExceptionCapture, STARTUP_EXCEPTION_CONTROL,
  STARTUP_EXCEPTION_SWITCH, STARTUP_EXCEPTION_TOKEN_ENV } from '../src/main/startupExceptionEvidence.ts';
import { ordinaryPath } from '../installer/windows-acceptance-harness/workspaceEncryptedEvidence.mjs';
import { readPackagedBuildInfo } from './readPackagedBuildInfo.mjs';

const MAX_STREAM_BYTES = 64 * 1024;

export async function prepareSmokeExceptionEvidence({ tempPath, smokeRootDirectory, smokeToken, installRoot }) {
  if (!/^[a-f0-9]{32}$/u.test(smokeToken)) throw new Error('PACKAGED_SMOKE_EVIDENCE_INVALID');
  const temp = await realpath(tempPath);
  const root = join(temp, 'eky-desktop-smoke', smokeToken);
  if (resolve(smokeRootDirectory) !== root) throw new Error('PACKAGED_SMOKE_EVIDENCE_INVALID');
  await ordinaryPath(temp, root, true);
  const userDataPath = join(root, 'user-data');
  await mkdir(userDataPath, { recursive: true, mode: 0o700 });
  await ordinaryPath(temp, userDataPath, true);
  await ordinaryPath(temp, join(root, 'result'), true);
  const identity = await readPackagedBuildInfo(installRoot);
  const token = smokeToken + randomBytes(16).toString('hex');
  await writeFile(join(root, 'result', STARTUP_EXCEPTION_CONTROL), JSON.stringify({
    schemaVersion: 1, scenarioRunNonce: token,
    appVersion: identity.appVersion, buildRevision: identity.buildRevision,
  }), { flag: 'wx', mode: 0o600 });
  const capture = createStartupExceptionCapture({ enabled: true, tempPath: temp, userDataPath, token,
    runtimeInstanceId: randomUUID(), appVersion: identity.appVersion, buildRevision: identity.buildRevision });
  if (!capture) throw new Error('PACKAGED_SMOKE_EVIDENCE_UNAVAILABLE');
  return { capture, arguments: [`--${STARTUP_EXCEPTION_SWITCH}`], environment: { [STARTUP_EXCEPTION_TOKEN_ENV]: token } };
}

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
