import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, constants, openSync, readSync } from 'node:fs';
import { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentIdentity } from './pidNamespaceActor.mjs';
import {
  actorArguments, childEnvironment, createDeadline, createFrames, createInitProtocol,
  descriptors, encodeMessage, expectedEofExit, failureExit, limits, message,
  NamespaceFailure, parseActorArguments, requireCondition, safeReason, validateIdentity, validateInitStatus,
} from './pidNamespaceContract.mjs';
import { createInitFailureReporter } from './pidNamespaceDiagnostics.mjs';

function readOwnStatus() {
  const fd = openSync('/proc/self/status', constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const bytes = Buffer.alloc(limits.status);
    let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (count === 0) return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used));
      used += count;
    }
    throw new Error('STATUS_LIMIT');
  } finally { closeSync(fd); }
}

export function runNamespaceInit({
  runtime = process, spawnChild = spawn, readStatus = readOwnStatus,
  socket = options => new Socket(options), nonce = () => randomBytes(16).toString('hex'),
  time = globalThis, now = () => process.hrtime.bigint(),
  argv = runtime.argv.slice(2), validateStatus = validateInitStatus, openChannels,
} = {}) {
  let timer;
  let finished = false;
  let deadline;
  let phase = 'context';
  let goAccepted = false;
  const reportFailure = createInitFailureReporter((line, done) => runtime.stderr.write(line, done));
  const finish = (code, cause = 'experimentFailed', failedPhase = phase) => {
    if (finished) return;
    if (code === expectedEofExit) {
      try { deadline.check('init'); } catch { code = failureExit; }
    }
    finished = true;
    if (code === failureExit && !goAccepted) reportFailure(failedPhase, cause);
    time.clearTimeout(timer);
    runtime.exit(code);
  };
  const fail = (error, failedPhase = phase) => finish(failureExit,
    failedPhase === 'statusRead' ? 'statusReadFailed' :
      error instanceof NamespaceFailure && error.initCause ? error.initCause : safeReason(error), failedPhase);
  try {
    requireCondition(runtime.platform === 'linux' && runtime.env.EKY_E2E === '1' &&
      runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true', 'invalidContext');
    phase = 'arguments';
    const config = parseActorArguments(argv);
    phase = 'deadline';
    deadline = createDeadline(config.started, now);
    timer = time.setTimeout(() => finish(failureExit, 'deadlineExceeded'), deadline.remaining('init'));
    deadline.check('ready');
    phase = 'pid';
    requireCondition(runtime.pid === 1, 'invalidIdentity');
    phase = 'identity';
    validateIdentity(currentIdentity(runtime), config);
    phase = 'statusRead';
    const status = readStatus();
    phase = 'statusValidation';
    validateStatus(status, config);
    phase = 'deadline';
    deadline.check('ready');
    const protocol = createInitProtocol(config.generation, deadline);
    phase = 'responseOpen';
    const { input, output, waitForConnect = false } = openChannels ? openChannels(config) :
      { input: runtime.stdin, output: socket({ fd: 3, readable: false, writable: true }) };
    output.on('error', () => finish(failureExit, 'channelFailed'));
    phase = 'controlSetup';
    const control = createFrames(value => {
      requireCondition(!finished && !goAccepted && control.pendingBytes === 0);
      protocol.go(value);
      goAccepted = true;
      // Re-check immediately at the only workload launch edge.
      deadline.check('ready');
      const root = spawnChild(runtime.execPath,
        [fileURLToPath(new URL('./pidNamespaceActor.mjs', import.meta.url)), ...actorArguments(config, 'root')], {
          cwd: runtime.cwd(), env: childEnvironment(), shell: false, detached: false,
          stdio: [...descriptors.root],
        });
      const leafChannel = root.stdio[4];
      // IPC delivery and process exit may arrive in either order.
      const challengeLeaf = () => {
        if (!protocol.canChallenge) return;
        const challenge = protocol.challenge(nonce());
        deadline.check('workload');
        leafChannel.write(encodeMessage(challenge), error => {
          if (error) finish(failureExit);
        });
      };
      root.on('message', receipt => {
        try {
          requireCondition(!finished);
          protocol.handoff(receipt);
          challengeLeaf();
        } catch { finish(failureExit); }
      });
      root.on('error', () => finish(failureExit));
      const leafFrames = createFrames(receipt => {
        // Reject even a partial trailing frame before publishing the leaf proof.
        requireCondition(leafFrames.pendingBytes === 0);
        protocol.leaf(receipt);
        output.write(encodeMessage(message('WORKLOAD', config.generation)), error => {
          try {
            if (error) return finish(failureExit);
            protocol.evidenceWritten();
          } catch { finish(failureExit); }
        });
      }, () => { requireCondition(!finished); protocol.leafBytes(); });
      leafChannel.on('data', chunk => { try { leafFrames.push(chunk); } catch { finish(failureExit); } });
      leafChannel.on('error', () => finish(failureExit));
      leafChannel.on('end', () => finish(failureExit));
      // Never wait for close: leaf intentionally keeps the root's fd4 stream open.
      root.once('exit', (code, signal) => {
        try {
          requireCondition(!finished);
          protocol.rootExit(code, signal);
          challengeLeaf();
        } catch { finish(failureExit); }
      });
    }, () => requireCondition(!finished && !goAccepted));
    input.on('data', chunk => { try { control.push(chunk); } catch (error) { fail(error, 'awaitGo'); } });
    input.on('error', () => finish(failureExit, 'channelFailed', 'awaitGo'));
    input.on('end', () => {
      try { control.end(); finish(protocol.eof()); } catch (error) { fail(error, 'awaitGo'); }
    });
    phase = 'readyWrite';
    const publishReady = () => {
      try {
        requireCondition(!finished, 'channelFailed');
        protocol.ready();
        output.write(encodeMessage(message('READY', config.generation)), error => {
          try { if (error) return finish(failureExit, 'channelFailed', 'readyWrite'); deadline.check('ready'); }
          catch (error) { fail(error, 'readyWrite'); }
        });
        phase = 'awaitGo';
      } catch (error) { fail(error, 'readyWrite'); }
    };
    if (waitForConnect) output.once('connect', publishReady);
    else publishReady();
  } catch (error) { fail(error); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runNamespaceInit();
