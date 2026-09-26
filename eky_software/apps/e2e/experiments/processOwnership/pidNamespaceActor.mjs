import { spawn } from 'node:child_process';
import { closeSync } from 'node:fs';
import { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  actorArguments, childEnvironment, createDeadline, createFrames, descriptors,
  encodeMessage, failureExit, isNonce, message, parseActorArguments,
  requireCondition, validateIdentity, validateMessage,
} from './pidNamespaceContract.mjs';

export function currentIdentity(runtime = process) {
  return { uid: runtime.getuid(), euid: runtime.geteuid(), gid: runtime.getgid(), egid: runtime.getegid() };
}

export function actorGuard(argv, environment, platform, identity) {
  requireCondition(platform === 'linux' && environment.EKY_E2E === '1' &&
    environment.CI === 'true' && environment.GITHUB_ACTIONS === 'true', 'invalidContext');
  const config = parseActorArguments(argv, true);
  validateIdentity(identity, config);
  return config;
}

export function runActor(config, {
  runtime = process, spawnChild = spawn, socket = options => new Socket(options),
  closeFd = closeSync, time = globalThis, now = () => process.hrtime.bigint(),
} = {}) {
  const deadline = createDeadline(config.started, now);
  const phase = config.role === 'sentinel' ? 'sentinel' : config.role === 'root' ? 'workload' : 'leaf';
  let finished = false;
  const finish = code => {
    if (finished) return;
    finished = true;
    time.clearTimeout(timer);
    runtime.exit(code);
  };
  const timer = time.setTimeout(() => finish(failureExit), deadline.remaining(phase));
  try {
    deadline.check(phase);
    if (config.role === 'root') {
      requireCondition(typeof runtime.send === 'function', 'invalidContext');
      const leaf = spawnChild(runtime.execPath,
        [fileURLToPath(import.meta.url), ...actorArguments(config, 'leaf')], {
          cwd: runtime.cwd(), env: childEnvironment(), shell: false, detached: true,
          stdio: [...descriptors.leaf],
        });
      leaf.on('error', () => finish(failureExit));
      leaf.once('spawn', () => {
        try {
          deadline.check('workload');
          closeFd(4);
          runtime.send(message('HANDOFF', config.generation), error => {
            if (error) return finish(failureExit);
            try {
              deadline.check('workload');
              runtime.disconnect();
              // The detached leaf owns the only child-side fd4 after this exit.
              finish(0);
            } catch { finish(failureExit); }
          });
        } catch { finish(failureExit); }
      });
      return;
    }

    const leaf = config.role === 'leaf';
    if (leaf) runtime.on('SIGTERM', () => {});
    const input = leaf ? socket({ fd: 4, readable: true, writable: true }) : runtime.stdin;
    const output = leaf ? input : socket({ fd: 3, readable: false, writable: true });
    const challenges = new Set();
    let stopped = false;
    const frames = createFrames(value => {
      deadline.check(leaf ? 'workload' : 'sentinel');
      requireCondition(!stopped);
      if (!leaf && value?.type === 'STOP') {
        validateMessage(value, config.generation, 'STOP');
        stopped = true;
        return finish(0);
      }
      requireCondition(isNonce(value?.challenge) && !challenges.has(value.challenge));
      requireCondition(challenges.size < (leaf ? 1 : 2));
      validateMessage(value, config.generation, 'CHALLENGE', value.challenge);
      challenges.add(value.challenge);
      output.write(encodeMessage(message('ALIVE', config.generation, value.challenge)), error => {
        try { if (error) return finish(failureExit); deadline.check(leaf ? 'workload' : 'sentinel'); }
        catch { finish(failureExit); }
      });
    });
    input.on('data', chunk => { try { frames.push(chunk); } catch { finish(failureExit); } });
    input.on('end', () => finish(failureExit));
    input.on('error', () => finish(failureExit));
    if (output !== input) output.on('error', () => finish(failureExit));
  } catch { finish(failureExit); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    requireCondition(process.platform === 'linux', 'notLinux');
    runActor(actorGuard(process.argv.slice(2), process.env, process.platform, currentIdentity()));
  } catch { process.exit(failureExit); }
}
