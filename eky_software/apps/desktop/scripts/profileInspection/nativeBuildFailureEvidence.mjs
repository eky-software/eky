import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';

export const inspectionNativeFailureMaximumBytes = 64 * 1024;
export const windowsNativePreparationBinding = Object.freeze({
  job: 'e2e-electron-windows-critical', jobKey: 'core-electron-0',
});
export const nativePreparationRecordMaximumBytes = 96 * 1024;
const fail = () => { throw Error('INSPECTION_NATIVE_EVIDENCE_UNVERIFIED'); };
const same = (left, right) => left.dev === right.dev && left.ino === right.ino &&
  left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs &&
  left.nlink === right.nlink;
const privateMode = (info, mode) => process.platform === 'win32' ||
  (info.uid === BigInt(process.getuid()) && info.gid === BigInt(process.getgid()) && (info.mode & 0o7777n) === BigInt(mode));

export async function readInspectionNativeBuildFailure(root, identity) {
  const directory = async path => {
    const info = await lstat(path, { bigint: true });
    if (!info.isDirectory() || info.isSymbolicLink() || !privateMode(info, 0o700) ||
      await realpath(path) !== path) fail();
    return info;
  };
  try {
    const before = await directory(root);
    if (before.dev !== BigInt(identity.dev) || before.ino !== BigInt(identity.ino)) fail();
    const entries = await readdir(root, { withFileTypes: true });
    if (entries.length === 0) return { status: 'missing' };
    if (entries.length !== 1 || !entries[0].isDirectory() ||
      !/^inspection-native-[A-Za-z0-9]{6}$/u.test(entries[0].name)) fail();
    const work = join(root, entries[0].name);
    const workBefore = await directory(work);
    const path = join(work, 'build.private.log');
    const info = await lstat(path, { bigint: true });
    const size = Number(info.size);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n ||
      !privateMode(info, 0o600) || !Number.isSafeInteger(size) || size < 1) fail();
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!same(info, await handle.stat({ bigint: true }))) fail();
      // Preserve the existing bounded start/end contract, never an arbitrary old build.
      const complete = size <= inspectionNativeFailureMaximumBytes;
      const prefix = Buffer.alloc(complete ? size : inspectionNativeFailureMaximumBytes / 2);
      const suffix = Buffer.alloc(complete ? 0 : inspectionNativeFailureMaximumBytes / 2);
      const first = await handle.read(prefix, 0, prefix.length, 0);
      const last = suffix.length === 0 ? { bytesRead: 0 }
        : await handle.read(suffix, 0, suffix.length, size - suffix.length);
      if (first.bytesRead !== prefix.length || last.bytesRead !== suffix.length ||
        !same(info, await handle.stat({ bigint: true })) || !same(info, await lstat(path, { bigint: true })) ||
        !same(workBefore, await directory(work)) || !same(before, await directory(root))) fail();
      return { status: 'retained', complete, sourceBytes: size,
        retainedBytes: prefix.length + suffix.length,
        prefixBase64: prefix.toString('base64'), suffixBase64: suffix.toString('base64') };
    } finally { await handle.close(); }
  } catch (error) { return { status: error.code === 'ENOENT' ? 'missing' : 'unverified' }; }
}

export function windowsNativeCompilationBinding(env, platform = process.platform) {
  if (platform !== 'win32' || env.GITHUB_ACTIONS !== 'true' || env.RUNNER_OS !== 'Windows' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !['push', 'schedule', 'workflow_dispatch', 'pull_request'].includes(env.GITHUB_EVENT_NAME) ||
    env.GITHUB_JOB !== windowsNativePreparationBinding.job ||
    (env.EKY_EVIDENCE_JOB_KEY !== undefined && env.EKY_EVIDENCE_JOB_KEY !== windowsNativePreparationBinding.jobKey) ||
    !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? '') ||
    !/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? '') ||
    !/^[a-f0-9]{40}$/u.test(env.GITHUB_SHA ?? '')) return null;
  return { runId: env.GITHUB_RUN_ID, attempt: env.GITHUB_RUN_ATTEMPT,
    ...windowsNativePreparationBinding, sourceRevision: env.GITHUB_SHA };
}

export function validateNativePreparationEvidence(record, binding, invocationId) {
  const exact = (value, keys) => value !== null && typeof value === 'object' &&
    !Array.isArray(value) && Object.keys(value).sort().join(',') === keys.sort().join(',');
  if (!exact(record, ['schemaVersion', 'operation', 'status', 'phase', 'causeCode',
    'binding', 'invocationId', 'nativeCompilationEvidence']) || record.schemaVersion !== 1 ||
    record.operation !== 'electronE2ePreparation' || record.status !== 'failed' ||
    record.phase !== 'nativeCompilation' || record.causeCode !== 'PROFILE_INSPECTION_NATIVE_BUILD_FAILED' ||
    !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(record.invocationId ?? '') ||
    record.invocationId !== invocationId || !exact(record.binding, Object.keys(binding)) ||
    Object.keys(binding).some(key => record.binding[key] !== binding[key])) fail();
  const evidence = record.nativeCompilationEvidence;
  if (evidence?.status === 'missing' || evidence?.status === 'unverified') {
    if (!exact(evidence, ['status'])) fail();
    return record;
  }
  if (!exact(evidence, ['status', 'complete', 'sourceBytes', 'retainedBytes', 'prefixBase64', 'suffixBase64']) ||
    evidence.status !== 'retained' || !Number.isSafeInteger(evidence.sourceBytes) || evidence.sourceBytes < 1 ||
    evidence.retainedBytes !== Math.min(evidence.sourceBytes, inspectionNativeFailureMaximumBytes) ||
    evidence.complete !== (evidence.sourceBytes <= inspectionNativeFailureMaximumBytes)) fail();
  for (const [field, size] of [['prefixBase64', evidence.complete ? evidence.sourceBytes : inspectionNativeFailureMaximumBytes / 2],
    ['suffixBase64', evidence.complete ? 0 : inspectionNativeFailureMaximumBytes / 2]]) {
    const value = evidence[field];
    if (typeof value !== 'string' || value.length > Math.ceil(size / 3) * 4) fail();
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length !== size || bytes.toString('base64') !== value) fail();
  }
  return record;
}
