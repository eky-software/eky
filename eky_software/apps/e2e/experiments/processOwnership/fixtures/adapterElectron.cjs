'use strict';
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { workspace, writeOnce } = require('./adapterFixture.cjs');
const { cwd, generation, scenario } = workspace();
const { app, BrowserWindow, session } = require('electron');
assert.equal(app.isReady(), false);

for (const name of ['userData', 'sessionData', 'logs', 'crashDumps']) {
  const directory = path.join(cwd, name);
  fs.mkdirSync(directory, { mode: 0o700 });
  assert.equal(fs.realpathSync(directory), directory);
  if (name === 'logs') app.setAppLogsPath(directory);
  else app.setPath(name, directory);
}
for (const flag of ['disable-background-networking', 'disable-component-update', 'disable-sync', 'no-proxy-server'])
  app.commandLine.appendSwitch(flag);
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');

if (scenario === 'beforeReady' || scenario === 'rootFirst') {
  const node = process.env.EKY_T3C_NODE;
  assert.ok(path.isAbsolute(node) && fs.statSync(node).isFile());
  const leaf = spawn(node, [path.join(cwd, 'adapterLeaf.cjs')], {
    cwd, env: process.env, detached: true, shell: false, windowsHide: true, stdio: 'ignore',
  });
  leaf.on('error', () => process.exit(72));
  leaf.unref();
  // This bounded synchronous wait intentionally prevents Electron's ready event.
  // Only the independently spawned leaf can publish the nonce-bound receipt.
  const deadline = performance.now() + 3_000;
  let acknowledged = false;
  while (performance.now() < deadline) {
    try {
      const file = path.join(cwd, 'adapter-leaf.json');
      const info = fs.lstatSync(file);
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.size <= 256);
      assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { schemaVersion: 1, generation, ready: true });
      acknowledged = true;
      break;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
  assert.equal(acknowledged, true);
  assert.equal(app.isReady(), false);
  if (scenario === 'beforeReady') {
    writeOnce('adapter-before-ready.json', { schemaVersion: 1, generation, beforeReady: true, leafAcknowledged: true });
    process.exit(29);
  }
}

const page = 'data:text/html,' + encodeURIComponent('<!doctype html><html><head>' +
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; base-uri \'none\'; form-action \'none\'">' +
  '<title>Ownership experiment</title></head><body><main>synthetic-marker</main></body></html>');
app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: details.url !== page && details.url !== 'about:blank' });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const window = new BrowserWindow({ show: false, width: 480, height: 320,
    webPreferences: { sandbox: true, contextIsolation: true, webSecurity: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-redirect', 'will-attach-webview'])
    window.webContents.on(event, value => value.preventDefault());
  app.on('window-all-closed', () => app.quit());
  await window.loadURL(page);
}).catch(() => process.exit(72));
