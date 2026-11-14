import assert from 'node:assert/strict';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import fs from 'node:fs/promises';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasExactPhaseKeys, readCommandPhaseJson } from '../acceptanceCommandPhaseInput.mjs';

const fixtureFile = fileURLToPath(import.meta.url);
const desktopRoot = fileURLToPath(new URL('../../../', import.meta.url));
const markerKind = 'startupSupportElectron';
const pathNames = ['appData', 'userData', 'sessionData', 'temp', 'logs', 'crashDumps'];
const invalid = () => { throw new Error('STARTUP_SUPPORT_FIXTURE_INVALID'); };
const bootstrap = `import { runStartupSupportFixture } from ${JSON.stringify(import.meta.url)};\nawait runStartupSupportFixture();\n`;

function paths(testRoot, runNonce) {
  const runRoot = join(testRoot, runNonce);
  return { testRoot, runRoot, inputPath: join(testRoot, 'startup-support-input.json'),
    appRoot: join(runRoot, 'app'), targetPath: join(runRoot, 'target.json.gz'),
    proofPath: join(runRoot, 'startup-support-proof.private.json'),
    electronPaths: Object.fromEntries(pathNames.map(name => [name, join(runRoot, name)])) };
}

async function directory(path) {
  const info = await fs.lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || await fs.realpath(path) !== path) invalid();
}

function regularFile(path, maximumBytes) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 ||
      info.size > maximumBytes || realpathSync.native(path) !== path) invalid();
  return readFileSync(path, 'utf8');
}

function manifest(runNonce, appVersion) {
  return { name: `eky-startup-support-${runNonce}`, version: appVersion,
    type: 'module', main: 'bootstrap.mjs', fixture: markerKind, runNonce };
}

export async function prepareStartupSupportFixture(context) {
  const project = await readCommandPhaseJson(join(desktopRoot, 'package.json'));
  assert.match(project.version, /^\d+\.\d+\.\d+$/u);
  const p = paths(context.testRoot, context.runNonce);
  await fs.mkdir(p.runRoot, { mode: 0o700 });
  for (const path of [p.appRoot, ...Object.values(p.electronPaths)]) await fs.mkdir(path, { mode: 0o700 });
  await fs.writeFile(join(p.runRoot, 'fixture-marker.json'), JSON.stringify({
    schemaVersion: 1, fixture: markerKind, runNonce: context.runNonce,
  }), { flag: 'wx' });
  await fs.writeFile(join(p.appRoot, 'package.json'), JSON.stringify(manifest(context.runNonce, project.version)), { flag: 'wx' });
  await fs.writeFile(join(p.appRoot, 'bootstrap.mjs'), bootstrap, { flag: 'wx' });
  await fs.writeFile(p.inputPath, JSON.stringify({ schemaVersion: 1, runNonce: context.runNonce,
    appVersion: project.version }), { flag: 'wx' });
  return readStartupSupportFixture(p.inputPath);
}

export async function readStartupSupportFixture(inputPath) {
  if (typeof inputPath !== 'string' || resolve(inputPath) !== inputPath ||
      basename(inputPath) !== 'startup-support-input.json') invalid();
  const testRoot = dirname(inputPath);
  if (dirname(testRoot) !== await fs.realpath(tmpdir()) || !/^eky supervisor [A-Za-z0-9]{6}$/u.test(basename(testRoot))) invalid();
  await directory(testRoot);
  if (await fs.realpath(inputPath) !== inputPath) invalid();
  const input = await readCommandPhaseJson(inputPath);
  if (!hasExactPhaseKeys(input, ['schemaVersion', 'runNonce', 'appVersion']) || input.schemaVersion !== 1 ||
      !/^[a-f0-9]{64}$/u.test(input.runNonce) || !/^\d+\.\d+\.\d+$/u.test(input.appVersion)) invalid();
  const p = paths(testRoot, input.runNonce);
  for (const path of [p.runRoot, p.appRoot, ...Object.values(p.electronPaths)]) await directory(path);
  const marker = await readCommandPhaseJson(join(p.runRoot, 'fixture-marker.json'));
  if (!hasExactPhaseKeys(marker, ['schemaVersion', 'fixture', 'runNonce']) ||
      marker.schemaVersion !== 1 || marker.fixture !== markerKind || marker.runNonce !== input.runNonce) invalid();
  const appManifest = await readCommandPhaseJson(join(p.appRoot, 'package.json'));
  assert.deepEqual(appManifest, manifest(input.runNonce, input.appVersion), 'STARTUP_SUPPORT_MANIFEST_INVALID');
  assert.equal(regularFile(join(p.appRoot, 'bootstrap.mjs'), 4096), bootstrap, 'STARTUP_SUPPORT_BOOTSTRAP_INVALID');
  regularFile(fixtureFile, 32 * 1024);
  return { ...p, runNonce: input.runNonce, appVersion: input.appVersion };
}

export async function runStartupSupportFixture() {
  const { app, BrowserWindow, dialog, utilityProcess } = await import('electron');
  const nativeExit = app.exit.bind(app);
  let p;
  try {
    const inputs = process.argv.filter(value => value.startsWith('--startup-support-input='));
    assert.equal(inputs.length, 1, 'STARTUP_SUPPORT_INPUT_REQUIRED');
    p = await readStartupSupportFixture(inputs[0].slice('--startup-support-input='.length));
    assert.equal(app.isPackaged, false, 'STARTUP_SUPPORT_REQUIRES_REAL_DEVELOPMENT');
    assert.equal(app.getVersion(), p.appVersion, 'STARTUP_SUPPORT_PROJECT_VERSION_REQUIRED');
    assert.equal(realpathSync.native(app.getAppPath()), p.appRoot, 'STARTUP_SUPPORT_APP_ROOT_INVALID');
    for (const name of pathNames) app.setPath(name, p.electronPaths[name]);
    for (const name of pathNames) assert.equal(app.getPath(name), p.electronPaths[name]);

    const { projectExceptionChain } = await import('../../../dist/main/startupExceptionEvidence.js');
    const counts = { windowsCreated: 0, businessForkAttempts: 0, sqliteLoadAttempts: 0,
      missingRootLookups: 0, missingRootFailures: 0, confirmationCalls: 0, saveCalls: 0, errorDialogs: 0 };
    let firstFailure;
    const remember = error => { firstFailure ??= error; };
    const guarded = work => (...args) => {
      try { return work(...args); } catch (error) { remember(error); throw error; }
    };
    app.on('browser-window-created', () => { counts.windowsCreated++; });
    utilityProcess.fork = guarded(() => {
      counts.businessForkAttempts++;
      throw new Error('STARTUP_SUPPORT_BUSINESS_FORK_FORBIDDEN');
    });
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (/^(?:node:sqlite|sqlite3?|better-sqlite3)(?:\/|$)/u.test(specifier) ||
          /(?:^|[/\\])(?:better_sqlite3|sqlite3)\.node$/u.test(specifier)) {
        counts.sqliteLoadAttempts++;
        const error = new Error('STARTUP_SUPPORT_SQLITE_FORBIDDEN');
        remember(error); throw error;
      }
      return nextResolve(specifier, context);
    } });
    const { WORKSPACE_REGISTRY_FILE_NAME } = await import('../../../dist/workspaces/registry/workspaceRegistryPaths.js');
    const { validateWorkspaceRegistry } = await import('../../../dist/workspaces/registry/workspaceRegistryValidation.js');
    const registry = validateWorkspaceRegistry(await readCommandPhaseJson(join(p.electronPaths.userData, WORKSPACE_REGISTRY_FILE_NAME)));
    assert.equal(registry.formatVersion, 2);
    assert.notEqual(registry.activeWorkspaceId, null);
    assert.equal(registry.workspaces.length, 1);
    assert.equal(registry.workspaces[0].lifecycleState, 'ready');
    const missingRoot = join(p.electronPaths.userData, 'workspaces', registry.activeWorkspaceId);
    const originalLstat = fs.lstat;
    let workspaceRootCallerObserved = false;
    // Observe the real filesystem rejection; never replace its result or error.
    fs.lstat = async function (path, ...args) {
      const named = path === missingRoot;
      if (named) {
        counts.missingRootLookups++;
        workspaceRootCallerObserved ||= new Error().stack.includes('/dist/workspaces/registry/inspectWorkspaceRoot.js');
      }
      try { return await originalLstat.call(this, path, ...args); }
      catch (error) { if (named && error.code === 'ENOENT') counts.missingRootFailures++; throw error; }
    };
    syncBuiltinESMExports();

    dialog.showMessageBox = guarded(options => {
      assert.equal(++counts.confirmationCalls, 1, 'STARTUP_SUPPORT_CONFIRMATION_REUSED');
      assert.deepEqual(options, {
        buttons: ['Sulje', 'Luo tukipaketti'], cancelId: 0, defaultId: 0, noLink: true, type: 'warning',
        title: 'Eky ei k\u00e4ynnistynyt', message: 'Paikallista sovellusta ei voitu k\u00e4ynnist\u00e4\u00e4 turvallisesti.',
        detail: 'Voit tallentaa rajatun tukipaketin luotetulle tukihenkil\u00f6lle. Paketti ei ole salattu.\n\nSe sis\u00e4lt\u00e4\u00e4 sovellusversiot ja saatavilla olevat turvalliset virhetiedot, ei yrityksen tietoja, PDF:i\u00e4, salasanoja tai lokihistoriaa. Tietokantaa ei tarkisteta.',
      }, 'STARTUP_SUPPORT_CONFIRMATION_OPTIONS_INVALID');
      return Promise.resolve({ response: 1, checkboxChecked: false });
    });
    dialog.showSaveDialog = guarded(options => {
      assert.equal(++counts.saveCalls, 1, 'STARTUP_SUPPORT_SAVE_REUSED');
      assert.equal(counts.confirmationCalls, 1);
      assert.match(options.defaultPath, /^eky-support-\d{4}-\d{2}-\d{2}\.json\.gz$/u);
      assert.deepEqual(options, { defaultPath: options.defaultPath, title: 'Tallenna Eky-tukipaketti',
        filters: [{ extensions: ['json.gz'], name: 'Eky-tukipaketti, GZip-pakattu JSON' }] }, 'STARTUP_SUPPORT_SAVE_OPTIONS_INVALID');
      return Promise.resolve({ canceled: false, filePath: p.targetPath });
    });
    dialog.showErrorBox = () => { counts.errorDialogs++; remember(new Error('STARTUP_SUPPORT_UNEXPECTED_ERROR_DIALOG')); };
    app.exit = code => {
      writeFileSync(p.proofPath, JSON.stringify({ schemaVersion: 1, runNonce: p.runNonce,
        nativeDialogResponsesStubbed: true, isPackaged: app.isPackaged,
        appVersion: app.getVersion(), electronVersion: process.versions.electron,
        architecture: process.arch, platform: process.platform, requestedExitCode: code,
        pathsIsolated: pathNames.every(name => app.getPath(name) === p.electronPaths[name]),
        liveWindows: BrowserWindow.getAllWindows().length, workspaceRootCallerObserved, ...counts,
        firstFailure: firstFailure === undefined ? null : projectExceptionChain(firstFailure),
      }), { flag: 'wx', mode: 0o600 });
      nativeExit(code);
    };
    await import('../../../dist/main/index.js');
  } catch (error) {
    // Use the existing recorder and reporter, not Electron's unhandled-error UI.
    const { createRunnerFailureSink } = await import('../../../../../test-reporters/runnerFailureEvidence.mjs');
    const sink = createRunnerFailureSink({ ...(p === undefined ? {} : { tempRoot: p.electronPaths.temp }) });
    sink.record({ runner: 'node', phase: 'startupSupportBootstrap', error, testName: 'startup support Electron',
      testId: p?.runNonce, file: import.meta.url, attempt: 0, retryCount: 0, repeatCount: 0 });
    await sink.flush();
    nativeExit(3);
  }
}
