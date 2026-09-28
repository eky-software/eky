'use strict';

const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const NODE_CASES = new Set(['nodeRootFirst', 'nodeRootFailure', 'nodeStop']);
const LEAF_ARGUMENT = '--leaf';
const FAILURE_LABEL = 'T3A_NODE_FIXTURE_FAILED';

function requireCondition(condition) {
  if (!condition) throw new Error(FAILURE_LABEL);
}

function validateWorkspace() {
  requireCondition(process.env.EKY_E2E === '1');
  const root = process.env.EKY_T3A_ROOT;
  requireCondition(typeof root === 'string' && path.isAbsolute(root));
  requireCondition(root === fs.realpathSync(root));
  const tempBase = process.env.EKY_T3A_TEMP_BASE;
  requireCondition(typeof tempBase === 'string' && path.isAbsolute(tempBase));
  requireCondition(path.dirname(root) === fs.realpathSync(tempBase));
  requireCondition(path.basename(root).startsWith('eky-t3a-'));
  const rootStat = fs.lstatSync(root);
  requireCondition(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  const cwd = process.cwd();
  const relative = path.relative(root, cwd);
  requireCondition(relative !== '' && !path.isAbsolute(relative));
  requireCondition(relative.split(path.sep).every((part) => part !== '..'));
  for (let current = cwd; current !== root; current = path.dirname(current)) {
    const stat = fs.lstatSync(current);
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink());
    requireCondition(current === fs.realpathSync(current));
  }
  const temporaryDirectory = path.join(cwd, 'tmp');
  const temporaryStat = fs.lstatSync(temporaryDirectory);
  requireCondition(temporaryStat.isDirectory() && !temporaryStat.isSymbolicLink());
  requireCondition(fs.realpathSync(temporaryDirectory) === temporaryDirectory);
  requireCondition(fs.realpathSync(os.tmpdir()) === temporaryDirectory);
  const node = process.env.EKY_T3A_NODE;
  requireCondition(typeof node === 'string' && path.isAbsolute(node));
  requireCondition(fs.realpathSync(node) === fs.realpathSync(process.execPath));
  requireCondition(process.env.EKY_T3A_MARKER === 'synthetic-marker');
  return cwd;
}

function idleUntilJobTermination() {
  // This keeps a portless workload alive; only the native Job owns its deadline.
  process.on('SIGTERM', () => {});
  process.on('SIGINT', () => {});
  setInterval(() => {}, 60_000);
}

function publishReady(cwd, scenario) {
  validateWorkspace();
  const destination = path.join(cwd, 'workload.json');
  try {
    fs.lstatSync(destination);
    throw new Error(FAILURE_LABEL);
  } catch (error) {
    requireCondition(error.code === 'ENOENT');
  }
  const pending = path.join(cwd, 'workload.json.pending');
  fs.writeFileSync(pending, JSON.stringify({ case: scenario, stage: 'ready' }) + '\n', {
    flag: 'wx', mode: 0o600,
  });
  // Each case has one writer; publish only after the create-new file is closed.
  fs.renameSync(pending, destination);
}

async function main() {
  const cwd = validateWorkspace();
  const scenario = process.env.EKY_T3A_CASE;
  const leaf = process.argv.length === 3 && process.argv[2] === LEAF_ARGUMENT;
  requireCondition(NODE_CASES.has(scenario) || (leaf && scenario === 'electronLaunchFailure'));
  if (leaf) {
    requireCondition(typeof process.send === 'function' && process.connected);
    idleUntilJobTermination();
    process.send({ stage: 'ready' }, (error) => {
      if (error) process.exit(1);
      if (process.connected) process.disconnect();
    });
    return;
  }
  requireCondition(process.argv.length === 2);
  const child = fork(__filename, [LEAF_ARGUMENT], {
    cwd,
    execPath: process.execPath,
    execArgv: [],
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  await new Promise((resolve, reject) => {
    let ready = false;
    child.once('error', () => reject(new Error(FAILURE_LABEL)));
    child.once('exit', () => reject(new Error(FAILURE_LABEL)));
    child.once('message', (message) => {
      if (message?.stage !== 'ready') return reject(new Error(FAILURE_LABEL));
      ready = true;
    });
    child.once('disconnect', () => {
      if (!ready) return reject(new Error(FAILURE_LABEL));
      child.unref();
      resolve();
    });
  });
  publishReady(cwd, scenario);
  if (scenario === 'nodeStop') {
    idleUntilJobTermination();
    return;
  }
  process.exit(scenario === 'nodeRootFailure' ? 23 : 0);
}

main().catch(() => {
  process.stderr.write(FAILURE_LABEL + '\n');
  // A failed root must not terminate the descendant whose ownership is under test.
  process.exit(1);
});
