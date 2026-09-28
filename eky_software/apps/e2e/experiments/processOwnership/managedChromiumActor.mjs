import * as filesystem from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { actorGuard, currentIdentity, runActor } from './pidNamespaceActor.mjs';
import { childEnvironment, createDeadline, failureExit, NamespaceFailure,
  requireCondition, validateIdentity } from './pidNamespaceContract.mjs';
import { inspectManagedRoot } from './managedNamespaceRoot.mjs';
import { createManagedChromiumFailureWriter } from './managedChromiumFailure.mjs';

const document = '<!doctype html><html lang="en"><title>Managed Chromium proof</title>' +
  '<button type="button" onclick="document.querySelector(\'[role=status]\').textContent=\'Chromium ready\'">' +
  'Run proof</button><p role="status">Pending</p></html>';
const apiBody = JSON.stringify({ proof: 'managed-chromium' });

export async function runManagedChromiumActor({
  runtime = process, argv = runtime.argv.slice(2), fs = filesystem, tempDirectory = tmpdir,
  now = () => process.hrtime.bigint(), time = globalThis, createHttpServer = createServer,
  loadPlaywright = () => import('@playwright/test'),
  loadNetworkBoundary = () => import('../../src/environment/e2eBrowserNetworkBoundary.ts'),
  handoff = runActor,
} = {}) {
  let phase = 'setup';
  let ended = false;
  let timer;
  let deadline;
  let writeFailure = () => false;
  let rejectStopped;
  const stopped = new Promise((resolve, reject) => { rejectStopped = reject; });
  stopped.catch(() => {});
  const stoppedError = new NamespaceFailure('workloadFailed');
  const fail = reason => {
    if (ended) return;
    ended = true;
    time.clearTimeout(timer);
    writeFailure(phase, reason);
    rejectStopped(stoppedError);
    runtime.exit(failureExit);
  };
  const check = () => {
    if (ended) throw stoppedError;
    try { deadline.check('workload'); }
    catch { fail('deadlineExceeded'); throw stoppedError; }
  };
  const proof = condition => {
    if (!condition) { fail('postconditionFailed'); throw stoppedError; }
  };
  const wait = async operation => {
    check();
    const result = await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), stopped]);
    check();
    return result;
  };
  const timeout = () => { check(); const remaining = deadline.remaining('workload'); proof(remaining > 0); return remaining; };
  try {
    requireCondition(Array.isArray(argv) && argv.length === 6 && typeof argv[5] === 'string' &&
      argv[5].startsWith('--root='), 'invalidArguments');
    const config = actorGuard(argv.slice(0, 5), runtime.env, runtime.platform, currentIdentity(runtime));
    requireCondition(config.role === 'root' && runtime.pid > 1 && runtime.ppid === 1 &&
      runtime.connected === true && typeof runtime.send === 'function', 'invalidContext');
    const cleanEnvironment = childEnvironment();
    requireCondition(Object.keys(runtime.env).length === Object.keys(cleanEnvironment).length &&
      Object.entries(cleanEnvironment).every(([key, value]) => runtime.env[key] === value), 'invalidContext');
    deadline = createDeadline(config.started, now);
    check();
    timer = time.setTimeout(() => fail('deadlineExceeded'), deadline.remaining('workload'));
    const root = argv[5].slice('--root='.length);
    const tempRoot = fs.realpathSync(tempDirectory());
    check();
    requireCondition(runtime.cwd() === root, 'rootFailed');
    const rootReceipt = inspectManagedRoot(root, config, { fs, tempDirectory: () => tempRoot });
    writeFailure = createManagedChromiumFailureWriter({ root, generation: config.generation,
      uid: config.uid, gid: config.gid, rootReceipt, tempRoot }, { fs, runtime });
    const checkRoot = () => {
      check();
      validateIdentity(currentIdentity(runtime), config);
      requireCondition(runtime.cwd() === root, 'rootFailed');
      inspectManagedRoot(root, config, { fs, previous: rootReceipt, tempDirectory: () => tempRoot });
      check();
    };
    const inspectScratch = (path, previous) => {
      checkRoot();
      const stat = fs.lstatSync(path);
      proof(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === config.uid && stat.gid === config.gid &&
        (stat.mode & 0o7777) === 0o700 && stat.dev === rootReceipt.dev && Number.isSafeInteger(stat.ino) &&
        stat.ino > 0 && fs.realpathSync(path) === path && (!previous || previous.ino === stat.ino));
      check();
      return Object.freeze({ dev: stat.dev, ino: stat.ino });
    };
    const temp = posix.join(root, 'browser-tmp');
    const home = posix.join(root, 'browser-home');
    checkRoot();
    fs.mkdirSync(temp, { mode: 0o700 });
    const tempReceipt = inspectScratch(temp);
    fs.mkdirSync(home, { mode: 0o700 });
    const homeReceipt = inspectScratch(home);

    phase = 'import';
    // The pinned registry resolves its installed cache before HOME/XDG redirect.
    const { chromium } = await wait(loadPlaywright);
    const { installE2eBrowserNetworkBoundary } = await wait(loadNetworkBoundary);
    proof(typeof chromium?.launch === 'function' && typeof installE2eBrowserNetworkBoundary === 'function');
    const browserEnvironment = Object.freeze({ ...cleanEnvironment, HOME: home, TMPDIR: temp,
      XDG_CACHE_HOME: posix.join(home, 'cache'), XDG_CONFIG_HOME: posix.join(home, 'config'),
      XDG_DATA_HOME: posix.join(home, 'data'), XDG_STATE_HOME: posix.join(home, 'state') });
    Object.assign(runtime.env, browserEnvironment);

    phase = 'launch';
    let origin;
    const server = createHttpServer((request, response) => {
      request.resume();
      if (request.method !== 'GET' || request.headers.host !== origin?.slice('http://'.length)) {
        response.writeHead(404); response.end(); return;
      }
      const body = request.url === '/' ? document : request.url === '/proof' ? apiBody : null;
      if (body === null) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { 'content-type': request.url === '/' ? 'text/html; charset=utf-8' : 'application/json',
        'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' });
      response.end(body);
    });
    server.on('error', () => fail('operationFailed'));
    await wait(() => new Promise(resolve => server.listen(0, '127.0.0.1', resolve)));
    const address = server.address();
    proof(address && typeof address === 'object' && address.address === '127.0.0.1' &&
      Number.isInteger(address.port) && address.port > 0 && address.port <= 65535);
    origin = `http://127.0.0.1:${address.port}`;
    inspectScratch(temp, tempReceipt);
    inspectScratch(home, homeReceipt);
    const browser = await wait(() => chromium.launch({ headless: true, env: browserEnvironment, timeout: timeout() }));
    let closingBrowser = false;
    browser.on('disconnected', () => { if (!closingBrowser) fail('operationFailed'); });
    proof(browser.isConnected());
    const context = await wait(() => browser.newContext({ locale: 'fi-FI', timezoneId: 'Europe/Helsinki', serviceWorkers: 'block' }));
    const boundary = await wait(() => installE2eBrowserNetworkBoundary(context, { backendOrigin: origin, webOrigin: origin }));
    const page = await wait(() => context.newPage());
    page.on('crash', () => fail('operationFailed'));
    page.on('pageerror', () => fail('operationFailed'));

    phase = 'assert';
    const navigation = await wait(() => page.goto(origin, { waitUntil: 'load', timeout: timeout() }));
    proof(navigation?.status() === 200);
    await wait(() => page.getByRole('button', { name: 'Run proof', exact: true }).click({ timeout: timeout() }));
    proof(await wait(() => page.getByRole('status').textContent({ timeout: timeout() })) === 'Chromium ready');
    const response = await wait(() => context.request.get(`${origin}/proof`, { timeout: timeout(), maxRedirects: 0 }));
    proof(response.status() === 200 && response.url() === `${origin}/proof`);
    proof(await wait(() => response.text()) === apiBody);
    boundary.assertNoBlockedRequests();

    phase = 'close';
    await wait(() => response.dispose());
    await wait(() => context.close());
    closingBrowser = true;
    await wait(() => browser.close());
    proof(!browser.isConnected());
    await wait(() => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())));
    proof(!server.listening);
    boundary.assertNoBlockedRequests();

    phase = 'tempCleanup';
    inspectScratch(temp, tempReceipt);
    // Do not hide a swallowed Playwright profile/artifact removal error.
    fs.rmdirSync(temp);
    inspectScratch(home, homeReceipt);
    await wait(() => fs.promises.rm(home, { recursive: true, force: false, maxRetries: 0 }));
    checkRoot();
    let absent = false;
    try { fs.lstatSync(home); } catch (error) { if (error?.code === 'ENOENT') absent = true; else throw error; }
    proof(absent);
    check();
    time.clearTimeout(timer);
    handoff(config, { runtime, time, now });
    ended = true;
    return true;
  } catch {
    if (!ended && deadline) { try { check(); } catch { /* Deadline failure is already latched. */ } }
    fail('operationFailed');
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runManagedChromiumActor();
}
