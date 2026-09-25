import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BUNDLE_VERSION, BUNDLE_SHA256, readVerifiedBundle, verifyBundle,
  createElectronHarness, deferred, turn } from './playwrightElectronBundleHarness.mjs';
import { CLEANUP_UNVERIFIED_MARKER as marker, isExpectedElectronLaunchFailure }
  from './fixtures/electronLaunchFailure.cjs';

const settings = { concurrency: false, timeout: 5000 };
const markerCount = (metadata) => metadata.log.filter((line) => line === marker).length;

test("abort before run preserves the original error without launch or cleanup", settings, async (t) => {
  const h = createElectronHarness(t);
  const primary = new Error("abort before launch");
  const abort = h.abort(primary);
  assert.equal((await h.run()).error, primary);
  await abort;
  assert.deepEqual(h.calls, []);
  assert.equal(markerCount(h.controller.metadata), 0);
});

test("launcher rejection stays outside the post-spawn cleanup catch", settings, async (t) => {
  const primary = new Error("launcher failure");
  const h = createElectronHarness(t, { launch: () => Promise.reject(primary) });
  assert.equal((await h.run()).error, primary);
  assert.deepEqual(h.calls, ["launch"]);
  assert.equal(h.interfaces.length, 0);
});

test('source guard: exact version and reviewed bytes, independently of behavior', () => {
  const { version, bytes } = readVerifiedBundle();
  assert.equal(version, BUNDLE_VERSION);
  assert.equal(BUNDLE_SHA256.length, 64);
  assert.throws(() => verifyBundle('1.62.2', bytes), /version before evaluation/);
  assert.throws(() => verifyBundle(version, Buffer.concat([bytes, Buffer.from('\n')])), /digest before evaluation/);
});

test('each factory owns fresh real dependency classes', settings, (t) => {
  const a = createElectronHarness(t);
  const b = createElectronHarness(t);
  for (const name of ['Electron', 'ElectronApplication', 'ProgressController', 'ManualPromise', 'EventsHelper'])
    assert.notEqual(a.api[name], b.api[name]);
});

for (const event of ['match', 'error', 'exit', 'close', 'abort']) {
  test(`real waitForLine: ${event} removes only its owned listeners`, settings, async (t) => {
    const h = createElectronHarness(t);
    const result = h.waitForLine(/^endpoint (.+)$/);
    let settled = false;
    result.then(() => { settled = true; });
    h.line('unrelated stderr');
    await turn();
    assert.equal(settled, false);
    const abortError = new Error('synthetic abort');
    let abort;
    if (event === 'match') h.line('endpoint expected');
    else if (event === 'abort') abort = h.abort(abortError);
    else h.event(event);
    const outcome = await result;
    await abort;
    if (event === 'match') assert.equal(outcome.value[1], 'expected');
    else if (event === 'abort') assert.equal(outcome.error, abortError);
    else assert.equal(outcome.error.message, 'Process failed to launch!');
    h.assertReleased();
    await h.endStderr();
  });
}

for (const phase of ['beforeNode', 'nodeConnecting']) {
  for (const event of ['error', 'exit', 'close']) {
    test(`launch owns early ${event} rejections: ${phase}`, settings, async (t) => {
      const connection = deferred();
      const cleanup = deferred();
      const h = createElectronHarness(t, { nodeConnect: () => connection.promise, kill: () => cleanup.promise });
      const result = h.run();
      await h.ready;
      if (phase === 'nodeConnecting') {
        h.line('Debugger listening on ws://127.0.0.1/node');
        await h.reached('nodeConnect');
      }
      h.event(event);
      await turn(); // Leave the actual sibling rejections unconsumed for one event-loop turn.
      connection.resolve(h.nodeTransport);
      await h.reached('kill');
      cleanup.resolve();
      assert.equal((await result).error.message, 'Process failed to launch!');
      assert.equal(markerCount(h.controller.metadata), 0);
      assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
      h.assertReleased();
    });
  }
}

test('early X-server derived rejection stays owned and later becomes launch error', settings, async (t) => {
  const h = createElectronHarness(t);
  const result = h.run();
  await h.ready;
  h.line('Unable to open X display');
  await turn();
  h.line('Debugger listening on ws://127.0.0.1/node');
  assert.match((await result).error.message, /^Unable to open X display!/);
  assert.equal(h.calls.includes('chromeConnect'), false);
  h.event('exit');
  await turn();
  h.assertReleased();
});

for (const disconnect of ['early', 'late', 'reject']) {
  test(`normal launch does not await pending side waits; disconnect ${disconnect}`, settings, async (t) => {
    const h = createElectronHarness(t);
    const result = h.run();
    await h.ready;
    h.line('DevTools listening on ws://127.0.0.1/chrome');
    if (disconnect === 'early') h.line('Waiting for the debugger to disconnect...');
    h.line('Debugger listening on ws://127.0.0.1/node');
    const { value: app, error } = await result;
    assert.equal(error, undefined);
    assert.ok(app instanceof h.api.ElectronApplication);
    assert.deepEqual(h.calls.filter((name) => name.startsWith('Runtime.')), ['Runtime.enable', 'Runtime.evaluate']);
    if (disconnect === 'late') h.line('Waiting for the debugger to disconnect...');
    h.event('exit');
    await turn();
    assert.equal(h.nodeTransport.closes, disconnect === 'reject' ? 0 : 1);
    assert.equal(h.calls.includes('kill'), false);
    h.assertReleased();
  });
}

for (const stage of ['nodeConnect', 'chromeConnect', 'browserConnect', 'Runtime.enable', 'Runtime.evaluate']) {
  test(`launch preserves the original ${stage} failure`, settings, async (t) => {
    const primary = new Error(`primary ${stage}`);
    const h = createElectronHarness(t, { [stage]: () => Promise.reject(primary) });
    const result = h.run();
    await h.ready;
    h.endpoints();
    assert.equal((await result).error, primary);
    assert.equal(markerCount(h.controller.metadata), 0);
    assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
    h.event('exit');
    await turn();
    h.assertReleased();
  });
}

for (const cleanupMode of ['resolve', 'deferredResolve', 'throw', 'reject', 'abortPending', 'abortResolve', 'abortReject']) {
  test(`cleanup ${cleanupMode}: primary error retained and uncertainty marked`, settings, async (t) => {
    const primary = new Error('original launch failure');
    const secondary = new Error('secondary cleanup failure');
    const cleanup = deferred();
    const h = createElectronHarness(t, {
      nodeConnect: () => Promise.reject(primary),
      kill: () => {
        if (cleanupMode === 'throw') throw secondary;
        if (cleanupMode === 'reject') return Promise.reject(secondary);
        return cleanupMode === 'resolve' ? Promise.resolve() : cleanup.promise;
      },
    });
    const result = h.run();
    let settled = false;
    result.then(() => { settled = true; });
    await h.ready;
    h.endpoints();
    await h.reached('kill');
    let abort;
    if (cleanupMode === 'deferredResolve' || cleanupMode.startsWith('abort')) {
      await turn();
      assert.equal(settled, false, 'pending cleanup must not claim completion');
      if (cleanupMode === 'deferredResolve') cleanup.resolve();
      else abort = h.abort(new Error('cleanup abort'));
    }
    const outcome = await result;
    await abort;
    if (cleanupMode === 'abortResolve') cleanup.resolve();
    if (cleanupMode === 'abortReject') cleanup.reject(secondary);
    h.event('exit');
    await turn();
    h.assertReleased();
    assert.equal(outcome.error, primary);
    assert.equal(markerCount(h.controller.metadata), ['resolve', 'deferredResolve'].includes(cleanupMode) ? 0 : 1);
    assert.equal(h.calls.filter((name) => name === 'kill').length, 1);
  });
}

for (const stage of ['nodeWait', 'nodeConnect', 'chromeWait', 'chromeConnect', 'browserConnect', 'Runtime.enable', 'Runtime.evaluate']) {
  test(`real controller abort at ${stage}, including late transport rejection`, settings, async (t) => {
    const pending = deferred();
    const h = createElectronHarness(t, { [stage]: () => pending.promise, kill: () => pending.promise });
    const result = h.run();
    await h.ready;
    if (stage !== 'nodeWait') h.line('Debugger listening on ws://127.0.0.1/node');
    if (!['nodeWait', 'nodeConnect', 'chromeWait'].includes(stage)) h.line('DevTools listening on ws://127.0.0.1/chrome');
    if (stage === 'chromeWait') { await h.reached('nodeConnect'); await turn(); }
    else if (stage !== 'nodeWait') await h.reached(stage);
    const primary = new Error(`abort at ${stage}`);
    const abort = h.abort(primary);
    const outcome = await result;
    await abort;
    pending.reject(new Error('late boundary rejection'));
    await turn();
    h.assertReleased();
    assert.equal(outcome.error, primary);
    assert.equal(markerCount(h.controller.metadata), 1, 'raw metadata must retain marker after abort');
  });
}

for (const cleanupMode of ['resolve', 'throw', 'reject', 'abort']) {
  test(`actual inprocess error chain and acceptance guard: cleanup ${cleanupMode}`, settings, async (t) => {
    const pending = deferred();
    const h = createElectronHarness(t, { kill: () => {
      if (cleanupMode === 'throw') throw new Error('cleanup throw');
      if (cleanupMode === 'reject') return Promise.reject(new Error('cleanup reject'));
      return cleanupMode === 'abort' ? pending.promise : Promise.resolve();
    } }, { client: true });
    const result = h.run();
    await h.ready;
    h.event('exit');
    await h.reached('kill');
    const metadata = h.metadata();
    const abort = cleanupMode === 'abort' ? h.abort(new Error('cleanup interrupted')) : undefined;
    const { error } = await result;
    await abort;
    await turn();
    h.assertReleased();
    const uncertain = cleanupMode !== 'resolve';
    assert.ok(error instanceof Error, 'real client errors must share the acceptance guard Error realm');
    assert.ok(error.message.includes('Process failed to launch!'));
    assert.equal(markerCount(metadata), uncertain ? 1 : 0);
    assert.equal(error.message.includes(marker), uncertain);
    assert.equal(isExpectedElectronLaunchFailure(error, h.clientAPI.errors.TimeoutError), !uncertain);
  });
}

test('actual acceptance guard rejects timeout and non-Error inputs', settings, (t) => {
  const h = createElectronHarness(t, {}, { client: true });
  const { TimeoutError } = h.clientAPI.errors;
  assert.equal(isExpectedElectronLaunchFailure(new Error('caught launch failure'), TimeoutError), true);
  for (const error of [new TimeoutError('deadline'), null, undefined, 'failure', { message: 'failure' }])
    assert.equal(isExpectedElectronLaunchFailure(error, TimeoutError), false);
});
