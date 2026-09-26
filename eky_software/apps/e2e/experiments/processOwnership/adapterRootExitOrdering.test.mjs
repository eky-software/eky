import assert from 'node:assert/strict';
import { test } from 'node:test';
import { captureLaunchOutcome, stopRootBeforeBridge } from './adapterRootExitOrdering.mjs';

const snapshot = (rootExitCode = 0) => ({ launched: true, creationCompleted: true, rootExited: true, rootExitCode,
  activeProcesses: 1, assignedBeforeResume: true, descendantsAfterRoot: true, bridgeLost: false,
  cleanup: 'pending', failure: null });
const terminal = (rootExitCode = 0) => ({ ...snapshot(rootExitCode), activeProcesses: 0, cleanup: 'processTreeAbsent' });
const deferred = () => Promise.withResolvers();
const defaults = () => ({ expectedExitCode: 0, deadline: 100, now: () => 0,
  observeRoot: async () => snapshot(), stopOwner: async () => terminal(), settleBridge: async () => ({ code: 0, signal: null }) });

for (const code of [0, 29]) test(`root ${code} is proved before stop, then and only then the held bridge settles`, async () => {
  const order = [];
  const root = deferred();
  const stop = deferred();
  const stopping = deferred();
  const bridge = deferred();
  const before = snapshot(code);
  const task = stopRootBeforeBridge({ ...defaults(), expectedExitCode: code,
    observeRoot: () => { order.push('observe'); return root.promise; },
    stopOwner: () => { order.push('stop'); stopping.resolve(); return stop.promise; },
    settleBridge: () => { order.push('bridge'); return bridge.promise; },
  });
  assert.deepEqual(order, ['observe']);
  root.resolve(before);
  await stopping.promise;
  assert.deepEqual(order, ['observe', 'stop']);
  // The post-stop state must not overwrite the previously proved live descendant.
  before.activeProcesses = 0;
  stop.resolve(terminal(code));
  bridge.resolve({ code, signal: null });
  const result = await task;
  assert.deepEqual(order, ['observe', 'stop', 'bridge']);
  assert.equal(result.rootBeforeStop.activeProcesses, 1);
  assert.ok(Object.isFrozen(result.rootBeforeStop));
  assert.deepEqual(result.bridgeOutcome, { code, signal: null });
});

test('a launch rejection is captured while root observation is still pending', async () => {
  const failure = new Error('synthetic early launch rejection');
  const observed = captureLaunchOutcome(() => Promise.reject(failure));
  const root = deferred();
  let stopped = false;
  const task = stopRootBeforeBridge({ ...defaults(), expectedExitCode: 29,
    observeRoot: () => root.promise,
    stopOwner: async () => { stopped = true; return terminal(29); },
    settleBridge: async () => {
      assert.equal(stopped, true);
      return observed;
    },
  });
  // Let the unhandled-rejection checkpoint pass before the launch is consumed.
  await new Promise(resolve => setImmediate(resolve));
  root.resolve(snapshot(29));
  assert.deepEqual((await task).bridgeOutcome, { status: 'rejected', error: failure });
});

test('the captured raw launch may reject only after owner stop releases it', async () => {
  const launch = deferred();
  const failure = new Error('synthetic expected launch rejection');
  const outcome = captureLaunchOutcome(() => launch.promise);
  const result = await stopRootBeforeBridge({ ...defaults(), expectedExitCode: 29,
    observeRoot: async () => snapshot(29),
    stopOwner: async () => { launch.reject(failure); return terminal(29); },
    settleBridge: () => outcome,
  });
  assert.deepEqual(result.bridgeOutcome, { status: 'rejected', error: failure });
});

test('capture preserves synchronous launch failures and unexpected successful applications', async () => {
  const error = new Error('synthetic launch setup failure');
  assert.deepEqual(await captureLaunchOutcome(() => { throw error; }), { status: 'rejected', error });
  const application = { synthetic: true };
  assert.deepEqual(await captureLaunchOutcome(() => Promise.resolve(application)), { status: 'fulfilled', application });
});

for (const change of [{ rootExitCode: 29 }, { activeProcesses: 0 }, { rootExited: false, rootExitCode: null },
  { descendantsAfterRoot: false }, { cleanup: 'processTreeAbsent' }, { failure: 'stdioDrainUnsettled' }]) {
  test(`invalid pre-stop observation prevents both later actions: ${JSON.stringify(change)}`, async () => {
    const called = [];
    await assert.rejects(stopRootBeforeBridge({ ...defaults(),
      observeRoot: async () => ({ ...snapshot(), ...change }),
      stopOwner: () => { called.push('stop'); }, settleBridge: () => { called.push('bridge'); },
    }));
    assert.deepEqual(called, []);
  });
}

for (const at of ['observeRoot', 'stopOwner', 'settleBridge']) {
  test(`original ${at} failure is preserved without executing later phases`, async () => {
    const failure = new Error(`synthetic ${at} failure`);
    const called = [];
    const actions = defaults();
    for (const name of ['observeRoot', 'stopOwner', 'settleBridge']) {
      const original = actions[name];
      actions[name] = async () => { called.push(name); if (name === at) throw failure; return original(); };
    }
    await assert.rejects(stopRootBeforeBridge(actions), error => error === failure);
    const phases = ['observeRoot', 'stopOwner', 'settleBridge'];
    assert.deepEqual(called, phases.slice(0, phases.indexOf(at) + 1));
  });
}

test('unverified cleanup does not become a bridge settlement or a pass', async () => {
  let settled = false;
  await assert.rejects(stopRootBeforeBridge({ ...defaults(),
    stopOwner: async () => ({ ...terminal(), cleanup: 'cleanupUnverified' }),
    settleBridge: async () => { settled = true; },
  }));
  assert.equal(settled, false);
});

for (const expiredAfter of ['beforeStart', 'observeRoot', 'stopOwner', 'settleBridge']) {
  test(`the shared deadline is not renewed at ${expiredAfter}`, async () => {
    let now = expiredAfter === 'beforeStart' ? 100 : 0;
    const called = [];
    const actions = { ...defaults(), now: () => now };
    for (const name of ['observeRoot', 'stopOwner', 'settleBridge']) {
      const original = actions[name];
      actions[name] = async () => { called.push(name); if (name === expiredAfter) now = 100; return original(); };
    }
    await assert.rejects(stopRootBeforeBridge(actions), /adapterDeadlineExceeded/);
    const phases = ['observeRoot', 'stopOwner', 'settleBridge'];
    assert.deepEqual(called, phases.slice(0, phases.indexOf(expiredAfter) + 1));
  });
}
