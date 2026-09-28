import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { actorArguments, childEnvironment, createDeadline, descriptors, message,
  responseChannel, waitWithin, writeMessage } from './pidNamespaceContract.mjs';
import { watchChild, emergencyStop } from './runPidNamespaceExperiment.mjs';
import { requireConsumerLoss } from './linuxConsumerLossContract.mjs';

// The existing independent sentinel gets its existing lifetime at launch, near
// fault arming. No restart, renewal or service-stop authority is introduced.
export function startLinuxConsumerSentinel({ root, identity, outerDeadline }, {
  runtime = process, spawnChild = spawn, now = () => process.hrtime.bigint(), time = globalThis,
  nonce = () => randomBytes(16).toString('hex'),
} = {}) {
  const started = now().toString();
  const ownDeadline = createDeadline(started, now);
  const deadline = outerDeadline ? Object.freeze({
    remaining: phase => Math.min(ownDeadline.remaining(phase), outerDeadline.remaining('wrapper')),
    check(phase) { ownDeadline.check(phase); outerDeadline.check('wrapper'); },
  }) : ownDeadline;
  const generation = nonce();
  const child = spawnChild(runtime.execPath, [fileURLToPath(new URL('./pidNamespaceActor.mjs', import.meta.url)),
    ...actorArguments({ ...identity, generation, started }, 'sentinel')], {
    cwd: root, env: childEnvironment(), shell: false, detached: false, stdio: [...descriptors.sentinel],
  });
  const owned = watchChild(child);
  let replies;
  let startupFailed = false;
  let forced = false;
  let before = false;
  let beforeFailure;
  let finishResult;
  const stop = () => { if (!owned.closed) { forced = true; emergencyStop(owned); } };
  const timer = time.setTimeout(stop, deadline.remaining('sentinel'));
  child.once('close', () => time.clearTimeout(timer));
  try { replies = responseChannel(child.stdio[3], deadline, time); }
  catch { startupFailed = true; }
  const tokens = new Set();
  const challenge = async () => {
    deadline.check('sentinel');
    requireConsumerLoss(!startupFailed && !forced && !owned.exited && !owned.closed && !owned.spawnCode && !owned.inputFailed);
    const token = nonce();
    requireConsumerLoss(!tokens.has(token)); tokens.add(token);
    const answer = replies.expect('ALIVE', generation, 'sentinel', token);
    await waitWithin(writeMessage(child.stdin, message('CHALLENGE', generation, token), deadline, 'sentinel'),
      deadline, 'sentinel', time);
    await waitWithin(answer, deadline, 'sentinel', time);
    replies.check();
    requireConsumerLoss(!replies.ended && !forced && !owned.exited && !owned.closed && !owned.inputFailed);
  };
  return Object.freeze({
    async before() {
      requireConsumerLoss(!before && !finishResult);
      try { await challenge(); before = true; }
      catch (error) { beforeFailure ??= error; throw error; }
    },
    finish() {
      finishResult ??= (async () => {
        try {
          if (beforeFailure) throw beforeFailure;
          requireConsumerLoss(before);
          await challenge();
          await waitWithin(writeMessage(child.stdin, message('STOP', generation), deadline, 'sentinel'),
            deadline, 'sentinel', time);
          await waitWithin(owned.completion, deadline, 'sentinel', time);
          replies.closed();
          requireConsumerLoss(!forced && owned.closed && owned.exited && owned.code === 0 && owned.signal === null &&
            !owned.spawnCode && !owned.inputFailed);
        } catch (error) {
          stop();
          try { await waitWithin(owned.completion, deadline, 'report', time); } catch { /* Retain uncertainty. */ }
          throw error;
        } finally { time.clearTimeout(timer); }
      })();
      finishResult.catch(() => {});
      return finishResult;
    },
  });
}
