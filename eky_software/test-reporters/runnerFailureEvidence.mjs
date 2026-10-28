import { randomUUID } from 'node:crypto';
import { lstat, mkdir, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  projectExceptionChain, STARTUP_EXCEPTION_LIMITS, STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS,
} from '../apps/desktop/src/main/startupExceptionEvidence.ts';

export const RUNNER_FAILURE_LIMIT = 128;
export const RUNNER_FAILURE_ROOT_PREFIX = 'eky-test-errors-';
export { STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS as RUNNER_FAILURE_DELIVERY_TIMEOUT_MS };
const runners = new Set(['node', 'vitest', 'playwright', 'native']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const uuid = value => typeof value === 'string' &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const exact = (value, keys) => value !== null && typeof value === 'object' &&
  Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length &&
  keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(value, key) ?? {}, 'value'));
const invalid = () => { throw new Error('TEST_FAILURE_EVIDENCE_INVALID'); };

// Validate only the bounded projection, never an arbitrary exception or environment object.
export function validateRunnerFailureEvidence(value) {
  const summary = Object.getOwnPropertyDescriptor(value ?? {}, 'kind')?.value === 'runnerFailureSummary';
  const keys = summary ? ['schemaVersion', 'kind', 'binding', 'invocationId', 'recordLimit',
    'status', 'observed', 'recorded', 'rejected', 'omitted', 'limited'] :
    ['schemaVersion', 'kind', 'binding', 'invocationId', 'sequence', 'recordLimit', 'runner', 'phase', 'test', 'exception'];
  if (!exact(value, keys) || value.schemaVersion !== 1 ||
    !uuid(value.invocationId) || value.recordLimit !== RUNNER_FAILURE_LIMIT) invalid();
  const binding = value.binding;
  if (!exact(binding, ['kind']) || binding.kind !== 'local') {
    if (!exact(binding, ['kind', 'runId', 'attempt', 'job', 'jobKey', 'sourceRevision', 'jobKeySource']) ||
      binding.kind !== 'github' || !['explicit', 'githubJob'].includes(binding.jobKeySource) ||
      typeof binding.runId !== 'string' || typeof binding.attempt !== 'string' ||
      typeof binding.sourceRevision !== 'string') invalid();
    let normalized;
    try {
      normalized = runnerFailureBinding({ GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: binding.runId,
        GITHUB_RUN_ATTEMPT: binding.attempt, GITHUB_JOB: binding.job, GITHUB_SHA: binding.sourceRevision,
        EKY_EVIDENCE_JOB_KEY: binding.jobKeySource === 'explicit' ? binding.jobKey : undefined });
    } catch { invalid(); }
    if (normalized.jobKey !== binding.jobKey || normalized.jobKeySource !== binding.jobKeySource) invalid();
  }
  if (summary) {
    if (!['recorded', 'partial', 'timedOut'].includes(value.status) || typeof value.limited !== 'boolean') invalid();
    for (const key of ['observed', 'recorded', 'rejected', 'omitted']) if (integer(value[key]) === null) invalid();
    if (value.observed > RUNNER_FAILURE_LIMIT || value.recorded + value.rejected > value.observed ||
      value.limited !== (value.omitted > 0) ||
      (value.status === 'recorded' && (value.limited || value.rejected !== 0 || value.recorded !== value.observed))) invalid();
    return value;
  }
  if (value.kind !== 'runnerFailure' || !Number.isInteger(value.sequence) || value.sequence < 1 ||
    value.sequence > RUNNER_FAILURE_LIMIT || !runners.has(value.runner) || !identifier(value.phase)) invalid();
  if (!exact(value.test, ['name', 'id', 'file', 'line', 'column', 'attempt', 'retryCount', 'repeatCount'])) invalid();
  for (const key of ['name', 'id', 'file']) {
    if (value.test[key] !== null && (typeof value.test[key] !== 'string' ||
      value.test[key].length > STARTUP_EXCEPTION_LIMITS.message)) invalid();
  }
  for (const key of ['line', 'column', 'attempt', 'retryCount', 'repeatCount']) {
    if (value.test[key] !== null && integer(value.test[key]) === null) invalid();
  }
  const exception = value.exception;
  if (!exact(exception, ['chain', 'incomplete']) || typeof exception.incomplete !== 'boolean' ||
    !Array.isArray(exception.chain) || Object.getPrototypeOf(exception.chain) !== Array.prototype ||
    exception.chain.length < 1 || exception.chain.length > STARTUP_EXCEPTION_LIMITS.depth ||
    Reflect.ownKeys(exception.chain).length !== exception.chain.length + 1) invalid();
  for (let index = 0; index < exception.chain.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(exception.chain, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) invalid();
    const part = descriptor.value;
    if (!exact(part, ['name', 'message', 'stack', 'truncated']) || typeof part.truncated !== 'boolean') invalid();
    for (const key of ['name', 'message', 'stack']) {
      if (part[key] !== null && (typeof part[key] !== 'string' || part[key].length > STARTUP_EXCEPTION_LIMITS[key])) invalid();
    }
  }
  if (Buffer.byteLength(JSON.stringify(value) + '\n') > STARTUP_EXCEPTION_LIMITS.fileBytes) invalid();
  return value;
}

export function runnerFailureBinding(env) {
  if (env.GITHUB_ACTIONS !== 'true') return { kind: 'local' };
  const { GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: attempt, GITHUB_JOB: job,
    GITHUB_SHA: sourceRevision } = env;
  const jobKey = env.EKY_EVIDENCE_JOB_KEY || job;
  if (!/^[1-9][0-9]{0,19}$/.test(runId ?? '') || !/^[1-9][0-9]{0,19}$/.test(attempt ?? '') ||
    !identifier(job) || !identifier(jobKey) || !/^[a-f0-9]{40}$/.test(sourceRevision ?? '')) {
    throw new Error('TEST_FAILURE_BINDING_INVALID');
  }
  return { kind: 'github', runId, attempt, job, jobKey, sourceRevision,
    jobKeySource: env.EKY_EVIDENCE_JOB_KEY ? 'explicit' : 'githubJob' };
}

// A private reporter sink only: no console capture, process control or result override.
export function createRunnerFailureSink({ env = process.env, tempRoot = tmpdir(), secrets = [] } = {}) {
  const invocationId = randomUUID();
  const pending = new Set();
  let directory;
  let observed = 0;
  let recorded = 0;
  let rejected = 0;
  let limited = false;
  let omitted = 0;
  let warned = false;
  let flushPromise;
  let binding;
  let knownSecrets;
  try {
    binding = runnerFailureBinding(env);
    knownSecrets = [...Object.entries(env)
      .filter(([key, value]) => /TOKEN|PASSWORD|SECRET|API_KEY|AUTHORIZATION/i.test(key) &&
        typeof value === 'string' && value.length > 0).map(([, value]) => value), ...secrets];
  } catch { /* Invalid CI identity disables private recording, never the test. */ }
  const text = value => typeof value === 'string'
    ? projectExceptionChain({ message: value }, knownSecrets).chain[0].message : null;
  const snapshot = status => ({ status, observed, recorded, rejected, limited, omitted, recordLimit: RUNNER_FAILURE_LIMIT });
  return {
    record({ runner, phase, testName, attempt, error, projectedException, testId, file, line, column, retryCount, repeatCount }) {
      if (observed >= RUNNER_FAILURE_LIMIT) {
        limited = true;
        omitted = Math.min(Number.MAX_SAFE_INTEGER, omitted + 1);
        return;
      }
      const sequence = ++observed;
      let bytes;
      try {
        if (!binding || !knownSecrets || !runners.has(runner) || !identifier(phase)) throw new Error();
        const record = { schemaVersion: 1, kind: 'runnerFailure', binding,
          invocationId, sequence, recordLimit: RUNNER_FAILURE_LIMIT, runner, phase,
          test: { name: text(testName), id: text(testId), file: text(file), line: integer(line),
            column: integer(column), attempt: integer(attempt), retryCount: integer(retryCount),
            repeatCount: integer(repeatCount) }, exception: projectedException ?? projectExceptionChain(error, knownSecrets) };
        if (projectedException !== undefined) {
          // The main process already bounded its source. Reapply the shared
          // redactor without erasing its truncation/coverage evidence.
          validateRunnerFailureEvidence(record);
          let reconstructed;
          for (const part of [...projectedException.chain].reverse()) {
            reconstructed = { name: part.name, message: part.message, stack: part.stack,
              ...(reconstructed === undefined ? {} : { cause: reconstructed }) };
          }
          const redacted = projectExceptionChain(reconstructed, knownSecrets);
          record.exception = { incomplete: projectedException.incomplete || redacted.incomplete,
            chain: redacted.chain.map((part, index) => ({ ...part,
              truncated: part.truncated || projectedException.chain[index].truncated })) };
        }
        bytes = Buffer.from(JSON.stringify(validateRunnerFailureEvidence(record)) + '\n');
        if (bytes.length > STARTUP_EXCEPTION_LIMITS.fileBytes) throw new Error();
      } catch { rejected++; return; }
      directory ??= (async () => {
        const base = await realpath(tempRoot);
        const root = join(base, RUNNER_FAILURE_ROOT_PREFIX + invocationId);
        await mkdir(root, { mode: 0o700 });
        const info = await lstat(root);
        if (!info.isDirectory() || info.isSymbolicLink() || await realpath(root) !== root) throw new Error();
        return root;
      })();
      const task = directory.then(root => writeFile(join(root, `${String(sequence).padStart(3, '0')}-${randomUUID()}.private.json`), bytes,
        { flag: 'wx', mode: 0o600, signal: AbortSignal.timeout(STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS) }))
        .then(() => { recorded++; }, () => { rejected++; });
      pending.add(task);
      void task.finally(() => pending.delete(task));
    },
    flush() {
      flushPromise ??= (async () => {
        let timer;
        const settled = Promise.all([...pending]).then(async () => {
          const status = rejected || limited ? 'partial' : 'recorded';
          if (observed === 0) return status;
          if (!directory || !binding) return 'partial';
          try {
            const summary = validateRunnerFailureEvidence({ schemaVersion: 1, kind: 'runnerFailureSummary',
              binding, invocationId, ...snapshot(status) });
            await writeFile(join(await directory, `${invocationId}.summary.private.json`), JSON.stringify(summary) + '\n',
              { flag: 'wx', mode: 0o600, signal: AbortSignal.timeout(STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS) });
            return status;
          } catch { return 'partial'; }
        });
        const deadline = new Promise(resolve => {
          timer = setTimeout(() => resolve('timedOut'), STARTUP_EXCEPTION_DELIVERY_TIMEOUT_MS);
        });
        try {
          const result = snapshot(await Promise.race([settled, deadline]));
          if (result.status !== 'recorded' && !warned) {
            warned = true;
            // Count-only warning: never output exception text, paths, identity or environment.
            try { process.stderr.write('EKY_TEST_FAILURE_EVIDENCE_PARTIAL ' + JSON.stringify(result) + '\n', () => {}); }
            catch { /* Evidence delivery must not replace the runner's result. */ }
          }
          return result;
        }
        finally { clearTimeout(timer); }
      })();
      return flushPromise;
    },
  };
}
