'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const FAILURE_LABEL = 'T3A_ELECTRON_MAIN_FAILED';
const STATIC_PAGE = 'data:text/html,' + encodeURIComponent(
  '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" ' +
  'content="default-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
  '<title>T3a synthetic fixture</title></head><body>' +
  '<main>synthetic-marker</main></body></html>',
);

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
  requireCondition(path.dirname(__filename) === cwd);
  const mainStat = fs.lstatSync(__filename);
  requireCondition(mainStat.isFile() && !mainStat.isSymbolicLink() && mainStat.nlink === 1);
  requireCondition(process.env.EKY_T3A_MARKER === 'synthetic-marker');
  requireCondition(['electronNormal', 'electronLaunchFailure'].includes(process.env.EKY_T3A_CASE));
  return cwd;
}

function fail() {
  process.stderr.write(FAILURE_LABEL + '\n');
  process.exit(1);
}

process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);

async function main() {
  const cwd = validateWorkspace();
  const { app, BrowserWindow, session } = require('electron');
  requireCondition(!app.isReady());
  for (const name of ['userData', 'sessionData', 'logs', 'crashDumps']) {
    const directory = path.join(cwd, name);
    fs.mkdirSync(directory, { mode: 0o700 });
    requireCondition(fs.realpathSync(directory) === directory);
    if (name === 'logs') app.setAppLogsPath(directory);
    else app.setPath(name, directory);
  }
  app.commandLine.appendSwitch('disable-background-networking');
  app.commandLine.appendSwitch('disable-component-update');
  app.commandLine.appendSwitch('disable-sync');
  app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  if (process.env.EKY_T3A_CASE === 'electronLaunchFailure') {
    requireCondition(!app.isReady());
    fs.writeFileSync(path.join(cwd, 'launch-failure.json'), JSON.stringify({
      beforeReady: true,
      intendedExit: true,
    }) + '\n', { flag: 'wx', mode: 0o600 });
    process.exit(29);
  }
  await app.whenReady();
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url !== STATIC_PAGE && details.url !== 'about:blank' });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  app.on('window-all-closed', () => app.quit());
  const window = new BrowserWindow({
    show: false,
    width: 480,
    height: 320,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      nodeIntegration: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on('will-redirect', (event) => event.preventDefault());
  window.webContents.on('will-attach-webview', (event) => event.preventDefault());
  await window.loadURL(STATIC_PAGE);
}

main().catch(fail);
