import { parseProbeContext, validEvidenceBinding } from './linuxPrerequisiteContract.mjs';

export const budgets = Object.freeze({
  ready: 5000, workload: 8000, init: 10000, leaf: 12000,
  wrapper: 14000, sentinel: 16000, report: 20000,
});
export const limits = Object.freeze({ frame: 512, channel: 4096, status: 16384, result: 4096 });
export const expectedEofExit = 41;
export const failureExit = 42;
export const unshareArguments = Object.freeze([
  '--user', '--map-current-user', '--setgroups=deny', '--mount',
  '--propagation=private', '--mount-proc=/proc', '--pid', '--fork',
  '--kill-child=SIGKILL', '--',
]);
export const descriptors = Object.freeze({
  wrapper: Object.freeze(['pipe', 'ignore', 'pipe', 'pipe']),
  sentinel: Object.freeze(['pipe', 'ignore', 'ignore', 'pipe']),
  root: Object.freeze(['ignore', 'ignore', 'ignore', 'ipc', 'pipe']),
  leaf: Object.freeze(['ignore', 'ignore', 'ignore', 'ignore', 4]),
});
const reasons = [
  'observed', 'unshareMissing', 'namespaceDenied', 'invalidContext', 'notLinux',
  'invalidIdentity', 'invalidStatus', 'invalidArguments', 'invalidMessage',
  'channelFailed', 'channelLimit', 'unexpectedEof', 'deadlineExceeded',
  'bootstrapUnknown', 'workloadFailed', 'cleanupUnverified', 'sentinelFailed',
  'rootFailed', 'reportFailed', 'experimentFailed',
];

export class NamespaceFailure extends Error {
  constructor(reason) {
    super('PID namespace experiment incomplete');
    this.reason = reasons.includes(reason) ? reason : 'experimentFailed';
  }
}

export function requireCondition(condition, reason = 'invalidMessage') {
  if (!condition) throw new NamespaceFailure(reason);
}

export function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const fields = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(fields).length === keys.length && keys.every(key =>
    Object.hasOwn(fields, key) && Object.hasOwn(fields[key], 'value') && fields[key].enumerable);
}

export function isNonce(value) {
  return typeof value === 'string' && value.length === 32 && /^[a-f0-9]{32}$/u.test(value);
}

export function safeReason(error) {
  return error instanceof NamespaceFailure ? error.reason : 'experimentFailed';
}

export function experimentContext(argv, environment) {
  if (environment?.CI !== 'true') return null;
  return parseProbeContext(argv, environment);
}

// No inherited preload, loader, NODE_OPTIONS, dynamic linker or user config hooks.
export function childEnvironment() {
  return { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
}

export function createDeadline(started, now = () => process.hrtime.bigint()) {
  requireCondition(typeof started === 'string' && /^[1-9][0-9]{0,23}$/u.test(started) &&
    !/[^0-9]/u.test(started), 'invalidArguments');
  const start = BigInt(started);
  const elapsed = () => {
    const current = now();
    requireCondition(typeof current === 'bigint' && current >= start, 'deadlineExceeded');
    return Number(current - start) / 1e6;
  };
  return Object.freeze({
    elapsed,
    remaining(phase) {
      requireCondition(Object.hasOwn(budgets, phase), 'invalidArguments');
      return Math.max(0, budgets[phase] - elapsed());
    },
    check(phase) {
      requireCondition(Object.hasOwn(budgets, phase) && elapsed() < budgets[phase], 'deadlineExceeded');
    },
  });
}

export function actorArguments({ generation, started, uid, gid }, role) {
  const args = [`--generation=${generation}`, `--started=${started}`, `--uid=${uid}`, `--gid=${gid}`];
  if (role) args.push(`--role=${role}`);
  parseActorArguments(args, Boolean(role));
  return args;
}

export function parseActorArguments(argv, actor = false) {
  requireCondition(Array.isArray(argv) && argv.length === (actor ? 5 : 4), 'invalidArguments');
  const values = {};
  for (const argument of argv) {
    requireCondition(typeof argument === 'string' && argument.length < 100, 'invalidArguments');
    const match = /^--(generation|started|uid|gid|role)=([a-z0-9]+)$/u.exec(argument);
    requireCondition(match && match[0] === argument && !Object.hasOwn(values, match[1]), 'invalidArguments');
    values[match[1]] = match[2];
  }
  requireCondition(exactKeys(values, actor ? ['generation', 'started', 'uid', 'gid', 'role']
    : ['generation', 'started', 'uid', 'gid']), 'invalidArguments');
  requireCondition(isNonce(values.generation) && /^[1-9][0-9]{0,23}$/u.test(values.started), 'invalidArguments');
  for (const key of ['uid', 'gid']) {
    requireCondition(/^[1-9][0-9]{0,9}$/u.test(values[key]) && Number(values[key]) < 4294967295, 'invalidArguments');
    values[key] = Number(values[key]);
  }
  requireCondition(!actor || ['root', 'leaf', 'sentinel'].includes(values.role), 'invalidArguments');
  return Object.freeze(values);
}

export function validateIdentity({ uid, euid, gid, egid }, expected) {
  requireCondition(Number.isSafeInteger(uid) && uid > 0 && uid < 4294967295 && uid === euid &&
    Number.isSafeInteger(gid) && gid > 0 && gid < 4294967295 && gid === egid &&
    uid === expected.uid && gid === expected.gid, 'invalidIdentity');
}

export function validateInitStatus(text, expected) {
  requireCondition(typeof text === 'string' && Buffer.byteLength(text) < limits.status &&
    !/[\0\r\uFFFD]/u.test(text), 'invalidStatus');
  const field = name => {
    const lines = text.split('\n').filter(line => line.startsWith(`${name}:`));
    requireCondition(lines.length === 1, 'invalidStatus');
    return lines[0].slice(name.length + 1).trim();
  };
  requireCondition(field('Pid') === '1', 'invalidIdentity');
  for (const [name, value] of [['Uid', expected.uid], ['Gid', expected.gid]]) {
    const ids = field(name).split(/\s+/u);
    requireCondition(ids.length === 4 && ids.every(id => id === String(value)), 'invalidIdentity');
  }
  for (const name of ['CapEff', 'CapPrm', 'CapInh', 'CapAmb']) {
    requireCondition(/^0{16}$/u.test(field(name)), 'invalidIdentity');
  }
}

const challengedTypes = ['CHALLENGE', 'ALIVE'];
const plainTypes = ['READY', 'GO', 'WORKLOAD', 'HANDOFF', 'STOP'];
export function message(type, generation, challenge) {
  const value = { version: 1, type, generation };
  if (challenge !== undefined) value.challenge = challenge;
  validateMessage(value, generation, type, challenge);
  return value;
}

export function validateMessage(value, generation, type, challenge) {
  const challenged = challengedTypes.includes(type);
  requireCondition((challenged || plainTypes.includes(type)) && isNonce(generation));
  requireCondition(exactKeys(value, challenged ? ['version', 'type', 'generation', 'challenge']
    : ['version', 'type', 'generation']));
  requireCondition(value.version === 1 && value.type === type && value.generation === generation);
  requireCondition(!challenged || (isNonce(challenge) && value.challenge === challenge));
  return value;
}

export function encodeMessage(value) {
  validateMessage(value, value.generation, value.type, value.challenge);
  const bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  requireCondition(bytes.length <= limits.frame, 'channelLimit');
  return bytes;
}

// Fail on bytes, not only complete messages, so pre-exit partial replies cannot be buffered.
export function createFrames(onMessage, onBytes = () => {}) {
  let pending = Buffer.alloc(0);
  let total = 0;
  let ended = false;
  return {
    push(chunk) {
      requireCondition(!ended && Buffer.isBuffer(chunk), 'channelFailed');
      onBytes();
      total += chunk.length;
      requireCondition(total <= limits.channel, 'channelLimit');
      pending = Buffer.concat([pending, chunk]);
      let index;
      while ((index = pending.indexOf(10)) !== -1) {
        requireCondition(index > 0 && index + 1 <= limits.frame, 'channelLimit');
        const line = new TextDecoder('utf-8', { fatal: true }).decode(pending.subarray(0, index));
        let value;
        try { value = JSON.parse(line); } catch { throw new NamespaceFailure('invalidMessage'); }
        // Canonical frames reject duplicate keys, whitespace and alternate encodings.
        requireCondition(JSON.stringify(value) === line);
        pending = pending.subarray(index + 1);
        onMessage(value);
      }
      requireCondition(pending.length < limits.frame, 'channelLimit');
    },
    end() {
      requireCondition(!ended && pending.length === 0, 'unexpectedEof');
      ended = true;
    },
    get pendingBytes() { return pending.length; },
  };
}

// One outstanding response per channel. Unsolicited/replayed bytes poison it permanently.
export function responseChannel(stream, deadline, time = globalThis) {
  let waiting;
  let fault;
  let ended = false;
  let timer;
  let receivedBytes = 0;
  const fail = error => {
    fault ??= error instanceof NamespaceFailure ? error : new NamespaceFailure('channelFailed');
    time.clearTimeout(timer);
    if (waiting) { const current = waiting; waiting = null; current.reject(fault); }
  };
  const frames = createFrames(value => {
    requireCondition(waiting);
    deadline.check(waiting.phase);
    validateMessage(value, waiting.generation, waiting.type, waiting.challenge);
    const current = waiting;
    waiting = null;
    time.clearTimeout(timer);
    current.resolve(value);
  }, () => requireCondition(waiting && !fault));
  stream.on('data', chunk => {
    receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : limits.channel + 1;
    try {
      frames.push(chunk);
      requireCondition(waiting || frames.pendingBytes === 0);
    } catch (error) { fail(error); }
  });
  stream.on('error', fail);
  stream.on('end', () => {
    ended = true;
    try { frames.end(); if (waiting) throw new NamespaceFailure('unexpectedEof'); }
    catch (error) { fail(error); }
  });
  stream.on('close', () => { if (!ended) fail(new NamespaceFailure('unexpectedEof')); });
  return {
    expect(type, generation, phase, challenge) {
      const result = new Promise((resolve, reject) => {
        try {
          if (fault) throw fault;
          requireCondition(!ended && !waiting, 'unexpectedEof');
          deadline.check(phase);
          waiting = { type, generation, phase, challenge, resolve, reject };
          timer = time.setTimeout(() => fail(new NamespaceFailure('deadlineExceeded')), deadline.remaining(phase));
        } catch (error) { reject(error); }
      });
      result.catch(() => {});
      return result;
    },
    check() { if (fault) throw fault; },
    closed() { this.check(); requireCondition(ended, 'unexpectedEof'); },
    get receivedBytes() { return receivedBytes; },
    get ended() { return ended; },
  };
}

export function writeMessage(stream, value, deadline, phase) {
  deadline.check(phase);
  return new Promise((resolve, reject) => {
    stream.write(encodeMessage(value), error => {
      try { if (error) throw new NamespaceFailure('channelFailed'); deadline.check(phase); resolve(); }
      catch (failure) { reject(failure); }
    });
  });
}

export function createInitProtocol(generation, deadline) {
  let phase = 'new';
  let challenge;
  let handedOff = false;
  const transition = (from, to, budget) => {
    deadline.check(budget);
    requireCondition(phase === from);
    phase = to;
  };
  return {
    ready() { transition('new', 'ready', 'ready'); },
    go(value) {
      validateMessage(value, generation, 'GO');
      transition('ready', 'running', 'ready');
    },
    handoff(value) {
      deadline.check('workload');
      validateMessage(value, generation, 'HANDOFF');
      requireCondition(!handedOff && ['running', 'rootExited'].includes(phase));
      handedOff = true;
    },
    rootExit(code, signal) {
      requireCondition(code === 0 && signal === null, 'workloadFailed');
      transition('running', 'rootExited', 'workload');
    },
    challenge(value) {
      requireCondition(handedOff && isNonce(value));
      transition('rootExited', 'challenged', 'workload');
      challenge = value;
      return message('CHALLENGE', generation, value);
    },
    leafBytes() {
      deadline.check('workload');
      requireCondition(phase === 'challenged');
    },
    leaf(value) {
      validateMessage(value, generation, 'ALIVE', challenge);
      transition('challenged', 'leafVerified', 'workload');
    },
    evidenceWritten() { transition('leafVerified', 'eofExpected', 'workload'); },
    eof() { transition('eofExpected', 'terminal', 'init'); return expectedEofExit; },
    get canChallenge() { return handedOff && phase === 'rootExited'; },
    get phase() { return phase; },
  };
}

export function classifyBootstrap({ spawnCode, code, signal, stderr, ready, go, streamsClosed, responseBytes, toolAbsent }) {
  if (ready || go || !streamsClosed || signal !== null || responseBytes !== 0) return 'bootstrapUnknown';
  if (spawnCode === 'ENOENT' && stderr === '' && toolAbsent === true) return 'unshareMissing';
  if (!spawnCode && code === 1 && stderr === 'unshare: unshare failed: Operation not permitted\n') {
    return 'namespaceDenied';
  }
  return 'bootstrapUnknown';
}

const resultFields = ['schemaVersion', 'evidence', 'consumer', 'checkoutSha', 'runId', 'runAttempt',
  'observation', 'reason', 'workloadOutcome', 'cleanupOutcome', 'evidenceOutcome',
  'sentinelOutcome', 'testRoot'];

export function resultFor(binding, facts) {
  const bound = validEvidenceBinding(binding);
  const reason = reasons.includes(facts.reason) ? facts.reason : 'experimentFailed';
  const success = reason === 'observed' && facts.workload && facts.destroyed && facts.sentinel;
  const absent = ['unshareMissing', 'namespaceDenied'].includes(reason) && !facts.go && facts.wrapperClosed && facts.sentinel;
  return {
    schemaVersion: 1, evidence: 'boundedPidNamespaceOnly',
    consumer: bound ? binding.consumer : null, checkoutSha: bound ? binding.checkoutSha : null,
    runId: bound ? binding.runId : null, runAttempt: bound ? binding.runAttempt : null,
    observation: success ? 'observed' : absent ? 'prerequisiteUnavailable' : 'failed',
    reason: bound ? (reason === 'observed' && !success ? 'experimentFailed' : reason) : 'invalidContext',
    workloadOutcome: facts.workload ? 'observed' : facts.go ? 'failed' : 'notStarted',
    cleanupOutcome: facts.destroyed ? 'namespaceDestroyed' : facts.launched ? 'unverified' : 'notStarted',
    evidenceOutcome: success || absent ? 'complete' : 'incomplete',
    sentinelOutcome: facts.sentinel ? 'preserved' : facts.sentinelStarted ? 'unverified' : 'notStarted',
    testRoot: facts.removed ? 'removed' : facts.removalStarted ? 'removalUnverified' : facts.rootCreated ? 'retained' : 'notCreated',
  };
}

export function serializeResult(value, binding) {
  requireCondition(exactKeys(value, resultFields), 'reportFailed');
  const bound = validEvidenceBinding(binding);
  requireCondition(bound || binding === null, 'reportFailed');
  for (const key of ['consumer', 'checkoutSha', 'runId', 'runAttempt']) {
    requireCondition(value[key] === (bound ? binding[key] : null), 'reportFailed');
  }
  requireCondition(value.schemaVersion === 1 && value.evidence === 'boundedPidNamespaceOnly' &&
    reasons.includes(value.reason), 'reportFailed');
  const enums = { observation: ['observed', 'prerequisiteUnavailable', 'failed'],
    workloadOutcome: ['observed', 'failed', 'notStarted'], cleanupOutcome: ['namespaceDestroyed', 'unverified', 'notStarted'],
    evidenceOutcome: ['complete', 'incomplete'], sentinelOutcome: ['preserved', 'unverified', 'notStarted'],
    testRoot: ['removed', 'retained', 'removalUnverified', 'notCreated'] };
  for (const [key, values] of Object.entries(enums)) requireCondition(values.includes(value[key]), 'reportFailed');
  if (value.observation === 'observed') {
    requireCondition(bound && value.reason === 'observed' && value.workloadOutcome === 'observed' &&
      value.cleanupOutcome === 'namespaceDestroyed' && value.sentinelOutcome === 'preserved' &&
      value.evidenceOutcome === 'complete' && value.testRoot === 'removed', 'reportFailed');
  } else if (value.observation === 'prerequisiteUnavailable') {
    requireCondition(bound && ['unshareMissing', 'namespaceDenied'].includes(value.reason) &&
      value.workloadOutcome === 'notStarted' && value.sentinelOutcome === 'preserved' &&
      value.evidenceOutcome === 'complete' && value.testRoot === 'retained', 'reportFailed');
  } else {
    requireCondition(value.reason !== 'observed' && value.evidenceOutcome === 'incomplete', 'reportFailed');
    if (['removed', 'removalUnverified'].includes(value.testRoot)) {
      requireCondition(value.cleanupOutcome === 'namespaceDestroyed' && value.sentinelOutcome === 'preserved' &&
        value.workloadOutcome === 'observed', 'reportFailed');
    }
  }
  const line = `${JSON.stringify(value)}\n`;
  requireCondition(Buffer.byteLength(line) <= limits.result, 'reportFailed');
  return line;
}
