'use strict';

const { ChildProcess, fork } = require('node:child_process');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { isExpectedElectronLaunchFailure } = require('./electronLaunchFailure.cjs');

const OPERATION_TIMEOUT_MS = 10_000;
const STDIO_LIMIT_BYTES = 64 * 1024;
const FAILURE_LABEL = 'T3A_ELECTRON_FIXTURE_FAILED';
const STDOUT_MARKER = 'T3A_SYNTHETIC_STDOUT';
const STDERR_MARKER = 'T3A_SYNTHETIC_STDERR';
let workspace;
let failurePhase = 'workspace';

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
  requireCondition(['electronNormal', 'electronLaunchFailure'].includes(process.env.EKY_T3A_CASE));
  requireCondition(process.env.EKY_T3A_MARKER === 'synthetic-marker');
  return { cwd, root, scenario: process.env.EKY_T3A_CASE };
}

function requireFile(file) {
  requireCondition(typeof file === 'string' && path.isAbsolute(file));
  requireCondition(fs.statSync(file).isFile());
  return file;
}

function writeWorkload(fields) {
  validateWorkspace();
  const destination = path.join(workspace.cwd, 'workload.json');
  try {
    fs.lstatSync(destination);
    throw new Error(FAILURE_LABEL);
  } catch (error) {
    requireCondition(error.code === 'ENOENT');
  }
  const pending = path.join(workspace.cwd, 'workload.json.pending');
  fs.writeFileSync(pending, JSON.stringify({
    case: workspace.scenario,
    ...fields,
  }) + '\n', { flag: 'wx', mode: 0o600 });
  // The native parent reads only the atomically published final name.
  fs.renameSync(pending, destination);
}

function sanitizedEnvironment() {
  const env = {};
  for (const name of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP']) {
    const entry = Object.entries(process.env).find(([key]) => key.toLowerCase() === name.toLowerCase());
    if (entry) env[name] = entry[1];
  }
  for (const name of ['EKY_E2E', 'EKY_T3A_CASE', 'EKY_T3A_ROOT', 'EKY_T3A_TEMP_BASE', 'EKY_T3A_NODE',
    'EKY_T3A_ELECTRON', 'EKY_T3A_E2E_PACKAGE', 'EKY_T3A_MARKER']) {
    env[name] = process.env[name];
  }
  for (const [name, directory] of Object.entries({
    HOME: 'electron-home', USERPROFILE: 'electron-profile',
    APPDATA: 'electron-appData', LOCALAPPDATA: 'electron-localAppData',
  })) {
    env[name] = path.join(workspace.cwd, directory);
    fs.mkdirSync(env[name], { mode: 0o700 });
  }
  env.NODE_ENV = 'test';
  return env;
}

// Operation bounds only reject observations; the native Job is the sole cleanup owner.
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(FAILURE_LABEL)), OPERATION_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

async function startResidualLeaf(env) {
  const child = fork(path.join(__dirname, 'nodeTree.cjs'), ['--leaf'], {
    cwd: workspace.cwd,
    execPath: process.execPath,
    execArgv: [],
    env,
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    windowsHide: true,
  });
  await bounded(new Promise((resolve, reject) => {
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
  }));
}

function captureMarker(stream, marker) {
  requireCondition(stream !== null && stream !== undefined);
  let buffer = Buffer.alloc(0);
  let overflow = false;
  let failed = false;
  let seen = false;
  let resolveSeen;
  let rejectSeen;
  const ready = new Promise((resolve, reject) => { resolveSeen = resolve; rejectSeen = reject; });
  // Attach the rejection handler before any asynchronous evaluation can fail.
  ready.catch(() => {});
  stream.on('data', (chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    const remaining = STDIO_LIMIT_BYTES - buffer.length;
    overflow ||= bytes.length > remaining;
    buffer = Buffer.concat([buffer, bytes.subarray(0, remaining)]);
    seen ||= buffer.includes(Buffer.from(marker + '\n'));
    if (seen) resolveSeen();
    if (overflow) rejectSeen(new Error(FAILURE_LABEL));
  });
  stream.once('end', () => { if (!seen) rejectSeen(new Error(FAILURE_LABEL)); });
  stream.once('error', () => {
    failed = true;
    rejectSeen(new Error(FAILURE_LABEL));
  });
  return { ready, valid: () => seen && !overflow && !failed };
}

function observeProcess(child, application) {
  let exitObserved = false;
  let closeObserved = false;
  let exitBeforeClose = false;
  let applicationCloseObserved = false;
  let exitBeforeApplicationClose = false;
  let successfulExit = false;
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => {
    exitObserved = true;
    successfulExit = code === 0 && signal === null;
    resolve();
  }));
  const closed = new Promise((resolve) => child.once('close', () => {
    closeObserved = true;
    exitBeforeClose = exitObserved;
    resolve();
  }));
  application.once('close', () => {
    applicationCloseObserved = true;
    exitBeforeApplicationClose = exitObserved;
  });
  return {
    finished: Promise.all([exited, closed]),
    snapshot: () => ({ exitObserved, closeObserved, exitBeforeClose,
      applicationCloseObserved, exitBeforeApplicationClose, successfulExit }),
  };
}

async function main() {
  workspace = validateWorkspace();
  failurePhase = 'launchSetup';
  const node = requireFile(process.env.EKY_T3A_NODE);
  requireCondition(fs.realpathSync(node) === fs.realpathSync(process.execPath));
  const executablePath = requireFile(process.env.EKY_T3A_ELECTRON);
  const e2ePackage = requireFile(process.env.EKY_T3A_E2E_PACKAGE);
  requireCondition(path.basename(e2ePackage) === 'package.json');
  requireCondition(path.basename(path.dirname(e2ePackage)) === 'e2e');
  requireCondition(path.basename(path.dirname(path.dirname(e2ePackage))) === 'apps');
  requireCondition(JSON.parse(fs.readFileSync(e2ePackage, 'utf8')).name === '@eky/e2e');
  const { _electron, errors } = createRequire(e2ePackage)('@playwright/test');
  const mainFile = path.join(workspace.cwd, 'electronMain.cjs');
  if (__dirname !== workspace.cwd) {
    fs.copyFileSync(path.join(__dirname, 'electronMain.cjs'), mainFile, fs.constants.COPYFILE_EXCL);
  }
  const mainStat = fs.lstatSync(mainFile);
  requireCondition(mainStat.isFile() && !mainStat.isSymbolicLink() && mainStat.nlink === 1);
  const env = sanitizedEnvironment();
  const artifactsDir = path.join(workspace.cwd, 'playwright-artifacts');
  fs.mkdirSync(artifactsDir, { mode: 0o700 });
  const launch = () => _electron.launch({
    executablePath,
    cwd: workspace.cwd,
    env,
    args: [mainFile, 'synthetic arg with spaces'],
    artifactsDir,
    chromiumSandbox: true,
    timeout: OPERATION_TIMEOUT_MS,
  });
  if (workspace.scenario === 'electronLaunchFailure') {
    const markerPath = path.join(workspace.cwd, 'launch-failure.json');
    try {
      fs.lstatSync(markerPath);
      throw new Error(FAILURE_LABEL);
    } catch (error) {
      requireCondition(error.code === 'ENOENT');
    }
    failurePhase = 'residualLeaf';
    await startResidualLeaf(env);
    let launchRejected = false;
    failurePhase = 'launchFailureObservation';
    try {
      await launch();
    } catch (error) {
      requireCondition(isExpectedElectronLaunchFailure(error, errors.TimeoutError));
      launchRejected = true;
    }
    failurePhase = 'launchMustReject';
    requireCondition(launchRejected);
    failurePhase = 'failureMarker';
    const stat = fs.lstatSync(markerPath);
    requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 256);
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    requireCondition(marker.beforeReady === true && marker.intendedExit === true);
    writeWorkload({ stage: 'ready', launchRejected, failureBeforeReady: true, residualLeafReady: true });
    return;
  }

  failurePhase = 'normalLaunch';
  const application = await launch();
  application.context().setDefaultTimeout(OPERATION_TIMEOUT_MS);
  const child = application.process();
  requireCondition(child instanceof ChildProcess && Number.isInteger(child.pid));
  requireCondition(child.exitCode === null && child.signalCode === null);
  const lifecycle = observeProcess(child, application);
  const stdout = captureMarker(child.stdout, STDOUT_MARKER);
  const stderr = captureMarker(child.stderr, STDERR_MARKER);
  const page = await application.firstWindow({ timeout: OPERATION_TIMEOUT_MS });
  await page.waitForURL(/^data:text\/html,/, { waitUntil: 'load', timeout: OPERATION_TIMEOUT_MS });
  requireCondition(await page.locator('main').textContent() === 'synthetic-marker');
  const observation = await bounded(application.evaluate(({ app, BrowserWindow }, input) => {
    const window = BrowserWindow.getAllWindows()[0];
    const preferences = window.webContents.getLastWebPreferences();
    process.stdout.write(input.stdout + '\n');
    process.stderr.write(input.stderr + '\n');
    return {
      mainPid: process.pid,
      markerPreserved: process.env.EKY_T3A_MARKER === 'synthetic-marker',
      argumentPreserved: process.argv.includes('synthetic arg with spaces'),
      cwdPreserved: process.cwd() === input.cwd,
      hiddenWindow: !window.isVisible(),
      contextIsolation: preferences.contextIsolation === true,
      sandbox: preferences.sandbox === true,
      webSecurity: preferences.webSecurity === true,
      nodeIntegrationDisabled: preferences.nodeIntegration === false,
      pathsIsolated: Object.entries(input.paths).every(([name, expected]) => app.getPath(name) === expected),
    };
  }, {
    cwd: workspace.cwd,
    stdout: STDOUT_MARKER,
    stderr: STDERR_MARKER,
    paths: Object.fromEntries(['userData', 'sessionData', 'logs', 'crashDumps'].map((name) =>
      [name, path.join(workspace.cwd, name)])),
  }));
  const { mainPid, ...checks } = observation;
  requireCondition(Number.isInteger(mainPid) && Object.values(checks).every((value) => value === true));
  await bounded(Promise.all([stdout.ready, stderr.ready]));
  await bounded(application.close());
  await bounded(lifecycle.finished);
  const lifecycleChecks = lifecycle.snapshot();
  requireCondition(lifecycleChecks.exitObserved && lifecycleChecks.closeObserved && lifecycleChecks.exitBeforeClose);
  requireCondition(lifecycleChecks.applicationCloseObserved && lifecycleChecks.successfulExit);
  requireCondition(stdout.valid() && stderr.valid());
  writeWorkload({
    stage: 'ready',
    ...checks,
    processHandleIsChildProcess: true,
    // Windows may expose the launch shell here, not the Electron main process.
    processHandleMatchesMain: child.pid === mainPid,
    stdoutMarkerCaptured: true,
    stderrMarkerCaptured: true,
    stdioBounded: true,
    closeResolved: true,
    ...lifecycleChecks,
  });
}

function fail(error, failureOrigin) {
  try {
    if (workspace) {
      writeWorkload({ stage: 'failed', code: 'fixtureFailed', failurePhase, failureOrigin });
      fs.writeFileSync(path.join(workspace.cwd, 'fixture-error.private.log'),
        String(error?.stack ?? error ?? FAILURE_LABEL).slice(0, STDIO_LIMIT_BYTES), { flag: 'wx', mode: 0o600 });
    }
  } catch {
    // Never overwrite an existing marker or write outside a validated workspace.
  }
  process.stderr.write(FAILURE_LABEL + '\n');
  process.exit(1);
}

process.on('uncaughtException', (error) => fail(error, 'uncaughtException'));
process.on('unhandledRejection', (error) => fail(error, 'unhandledRejection'));
main().then(() => process.exit(0)).catch((error) => fail(error, 'mainRejected'));
