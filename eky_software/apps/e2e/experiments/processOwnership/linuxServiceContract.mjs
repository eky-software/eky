import { posix } from 'node:path';
import { currentIdentity } from './pidNamespaceActor.mjs';
import { exactKeys, isNonce, validateIdentity } from './pidNamespaceContract.mjs';
import { chromiumWorkerProtocol, chromiumReadyName } from '../../src/environment/chromiumWorkerContract.mjs';

export const linuxServiceLimits = Object.freeze({
  config: 65_536, frame: 524_288, output: 65_536, proc: 16_384,
  cleanupMilliseconds: 3000,
});
export const linuxChromiumServerEntry = 'apps/e2e/src/environment/linuxOwnedChromiumServer.mjs';
export function linuxChromiumPaths(config) {
  requireService(typeof config.browserGeneration === 'string' && config.browserGeneration.length === 64 &&
    /^[a-f0-9]{64}$/u.test(config.browserGeneration));
  const root = posix.join(servicePath(config.runRoot), 'chromium-browser-' + config.browserGeneration);
  return Object.freeze({ root, temp: posix.join(root, 'temp'), config: posix.join(root, 'browser.json'),
    ready: posix.join(root, chromiumReadyName) });
}
export function linuxChromiumBrowserConfig(config) {
  return Object.freeze({ protocol: chromiumWorkerProtocol, schemaVersion: 1, generation: config.browserGeneration,
    browserExecutable: config.browserExecutable, runRoot: config.runRoot, startUntil: config.startUntil });
}
const reasons = ['preparationFailed', 'startupDeadlineExceeded', 'launchFailed',
  'workloadExited', 'observationLost', 'cleanupUnverified'];
export function serviceFailure(reason = 'observationLost') {
  return Object.assign(new Error('E2E_LINUX_SERVICE_' + (reason === 'cleanupUnverified'
    ? 'CLEANUP_UNVERIFIED' : 'FAILED')), { reason: reasons.includes(reason) ? reason : 'observationLost' });
}
export function requireService(condition, reason = 'preparationFailed') {
  if (!condition) throw serviceFailure(reason);
}
export function guardLinuxService(runtime = process) {
  requireService(runtime.platform === 'linux' && runtime.env.EKY_E2E === '1' &&
    runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true');
  const identity = currentIdentity(runtime);
  validateIdentity(identity, identity);
  return identity;
}
export function servicePath(value) {
  requireService(typeof value === 'string' && value.length < 2048 &&
    /^\/[A-Za-z0-9_./@+()-]+$/u.test(value) && !/[^A-Za-z0-9_./@+()-]/u.test(value) &&
    !value.endsWith('/') && posix.normalize(value) === value);
  return value;
}
export function below(path, root) {
  requireService(servicePath(path).startsWith(servicePath(root) + '/'));
  return path;
}
export function validateServiceConfig(value) {
  const common = ['version', 'profile', 'generation', 'uid', 'gid', 'root', 'repositoryRoot',
    'runRoot', 'node', 'startUntil', 'workUntil', 'redactedValues'];
  const fields = value?.profile === 'backend' ? ['runtimeConfigPath']
    : value?.profile === 'vite' ? ['webPort', 'environmentRoot', 'backendOrigin', 'sessionSecret']
      : value?.profile === 'chromium' ? ['browserExecutable', 'browserGeneration'] : null;
  requireService(fields !== null && exactKeys(value, [...common, ...fields]));
  requireService(value.version === 1 && isNonce(value.generation));
  validateIdentity({ uid: value.uid, euid: value.uid, gid: value.gid, egid: value.gid }, value);
  for (const key of ['root', 'repositoryRoot', 'runRoot', 'node']) servicePath(value[key]);
  requireService(/^eky-managed-ns-[A-Za-z0-9]{6}$/u.test(posix.basename(value.root)) &&
    posix.basename(value.node) === 'node' && /^run-[A-Za-z0-9-]+$/u.test(posix.basename(value.runRoot)));
  for (const key of ['startUntil', 'workUntil']) {
    requireService(typeof value[key] === 'string' && /^[1-9][0-9]{0,23}$/u.test(value[key]));
  }
  requireService(BigInt(value.startUntil) <= BigInt(value.workUntil));
  requireService(Array.isArray(value.redactedValues) && value.redactedValues.length <= 16 &&
    value.redactedValues.every(item => typeof item === 'string' && item.length > 0 && item.length <= 2048 &&
      !/[\0\r\n]/u.test(item)));
  if (value.profile === 'backend') below(value.runtimeConfigPath, value.runRoot);
  else if (value.profile === 'chromium') {
    servicePath(value.browserExecutable);
    requireService(posix.basename(value.browserExecutable) === 'chrome' &&
      posix.basename(posix.dirname(value.browserExecutable)) === 'chrome-linux64');
    linuxChromiumPaths(value);
  } else {
    requireService(Number.isSafeInteger(value.webPort) && value.webPort > 0 && value.webPort <= 65_535 &&
      typeof value.sessionSecret === 'string' && /^[A-Za-z0-9_-]{43}$/u.test(value.sessionSecret));
    const origin = typeof value.backendOrigin === 'string'
      ? /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/u.exec(value.backendOrigin) : null;
    requireService(origin !== null && Number(origin[1]) <= 65_535 && Number(origin[1]) !== 80);
    below(value.environmentRoot, value.runRoot);
  }
  return value;
}

// hrtime is the same monotonic host clock on both sides of this PID namespace.
// The caller samples it BEFORE reading its original fixture lifetime.
export function serviceDeadlines(config, now = () => process.hrtime.bigint()) {
  let previous = now();
  requireService(typeof previous === 'bigint' && previous > 0n, 'startupDeadlineExceeded');
  let broken = false;
  let cleanup;
  const clock = () => {
    const current = now();
    if (broken || typeof current !== 'bigint' || current < previous) {
      broken = true;
      throw serviceFailure('startupDeadlineExceeded');
    }
    previous = current;
    return current;
  };
  const end = phase => {
    requireService(['ready', 'work', 'wrapper'].includes(phase));
    return phase === 'ready' ? BigInt(config.startUntil) : phase === 'work'
      ? BigInt(config.workUntil) : cleanup ?? BigInt(config.workUntil) + 3_000_000_000n;
  };
  return Object.freeze({
    remaining(phase) { return Math.max(0, Number(end(phase) - clock()) / 1e6); },
    check(phase) { requireService(clock() < end(phase), 'startupDeadlineExceeded'); },
    beginCleanup() {
      const candidate = clock() + BigInt(linuxServiceLimits.cleanupMilliseconds) * 1_000_000n;
      const maximum = BigInt(config.workUntil) + BigInt(linuxServiceLimits.cleanupMilliseconds) * 1_000_000n;
      cleanup ??= candidate < maximum ? candidate : maximum;
    },
  });
}

export function validateServiceMessage(value, generation) {
  requireService(value?.version === 1 && value.generation === generation && isNonce(generation), 'observationLost');
  const common = ['version', 'generation', 'type', 'sequence'];
  const types = ['ready', 'go', 'status', 'rss', 'stop', 'started', 'snapshot', 'stopping', 'exit', 'failed'];
  requireService(types.includes(value.type) && Number.isSafeInteger(value.sequence) && value.sequence >= 0,
    'observationLost');
  if (['started', 'snapshot', 'exit', 'failed', 'stopping'].includes(value.type)) {
    requireService(exactKeys(value, [...common, 'state', 'spawned', 'stdout', 'stderr', 'rssBytes']) &&
      ['pending', 'running', 'exited', 'unavailable'].includes(value.state) && typeof value.spawned === 'boolean' &&
      ['stdout', 'stderr'].every(key => typeof value[key] === 'string' &&
        Buffer.byteLength(value[key]) <= linuxServiceLimits.output) &&
      (value.rssBytes === null || (Number.isSafeInteger(value.rssBytes) && value.rssBytes > 0 &&
        value.state === 'running')), 'observationLost');
  } else requireService(exactKeys(value, common), 'observationLost');
  return value;
}
export function serviceMessage(generation, type, sequence, snapshot) {
  return validateServiceMessage({ version: 1, generation, type, sequence, ...snapshot }, generation);
}
export function encodeServiceMessage(value) {
  validateServiceMessage(value, value.generation);
  const bytes = Buffer.from(JSON.stringify(value) + '\n');
  requireService(bytes.length <= linuxServiceLimits.frame, 'observationLost');
  return bytes;
}
export function serviceFrames(receive, multiple = false) {
  let pending = Buffer.alloc(0);
  let ended = false;
  return {
    push(chunk) {
      requireService(!ended && Buffer.isBuffer(chunk) && chunk.length + pending.length <= linuxServiceLimits.frame,
        'observationLost');
      pending = Buffer.concat([pending, chunk]);
      let index = pending.indexOf(10);
      if (index < 0) return;
      // Every command/reply is solicited. Reject pipelined or partial trailing
      // commands before delivering GO, not after the workload has spawned.
      requireService(multiple || index === pending.length - 1, 'observationLost');
      while (index >= 0) {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, index));
        const value = JSON.parse(text);
        requireService(JSON.stringify(value) === text, 'observationLost');
        pending = pending.subarray(index + 1);
        receive(value);
        index = pending.indexOf(10);
      }
    },
    end() { requireService(!ended && pending.length === 0, 'observationLost'); ended = true; },
  };
}
