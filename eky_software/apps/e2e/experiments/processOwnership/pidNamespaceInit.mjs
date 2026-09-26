import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, constants, openSync, readSync } from 'node:fs';
import { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { currentIdentity } from './pidNamespaceActor.mjs';
import {
  actorArguments, childEnvironment, createDeadline, createFrames, createInitProtocol,
  descriptors, encodeMessage, expectedEofExit, failureExit, limits, message,
  parseActorArguments, requireCondition, validateIdentity, validateInitStatus,
} from './pidNamespaceContract.mjs';

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
} = {}) {
  let timer;
  let finished = false;
  let deadline;
  const finish = code => {
    if (finished) return;
    if (code === expectedEofExit) {
      try { deadline.check('init'); } catch { code = failureExit; }
    }
    finished = true;
    time.clearTimeout(timer);
    runtime.exit(code);
  };
  try {
    requireCondition(runtime.platform === 'linux' && runtime.env.EKY_E2E === '1' &&
      runtime.env.CI === 'true' && runtime.env.GITHUB_ACTIONS === 'true', 'invalidContext');
    const config = parseActorArguments(runtime.argv.slice(2));
    deadline = createDeadline(config.started, now);
    timer = time.setTimeout(() => finish(failureExit), deadline.remaining('init'));
    deadline.check('ready');
    requireCondition(runtime.pid === 1, 'invalidIdentity');
    validateIdentity(currentIdentity(runtime), config);
    validateInitStatus(readStatus(), config);
    deadline.check('ready');
    const protocol = createInitProtocol(config.generation, deadline);
    const output = socket({ fd: 3, readable: false, writable: true });
    output.on('error', () => finish(failureExit));
    const control = createFrames(value => {
      requireCondition(!finished);
      protocol.go(value);
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
    });
    runtime.stdin.on('data', chunk => { try { control.push(chunk); } catch { finish(failureExit); } });
    runtime.stdin.on('error', () => finish(failureExit));
    runtime.stdin.on('end', () => {
      try { control.end(); finish(protocol.eof()); } catch { finish(failureExit); }
    });
    protocol.ready();
    output.write(encodeMessage(message('READY', config.generation)), error => {
      try { if (error) return finish(failureExit); deadline.check('ready'); }
      catch { finish(failureExit); }
    });
  } catch { finish(failureExit); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) runNamespaceInit();
