import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { adapterCases, outerObservationBudget, streamLimit, validateCaseEvidence } from './adapterContract.mjs';
import { beforeDeadline } from './adapterControl.mjs';
import { boundedFailureDetails, observeBoundedChildOutput } from './boundedChildOutput.mjs';
import { experimentEnvironment, validateTerminal } from './experimentContract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2e = path.resolve(here, '../..');
const desktopRequire = createRequire(path.resolve(e2e, '../desktop/package.json'));
const token = () => randomBytes(32).toString('hex');

async function jsonFile(filename) {
  const info = await stat(filename);
  assert.ok(info.isFile() && info.nlink === 1 && info.size <= streamLimit);
  return JSON.parse(await readFile(filename, 'utf8'));
}

function observe(child) {
  const observation = { closed: false, capture: observeBoundedChildOutput(child) };
  observation.done = new Promise(resolve => {
    child.once('error', () => { observation.spawnFailed = true; });
    child.once('close', (code, signal) => { observation.closed = true; resolve({ code, signal }); });
  });
  child.stdin?.on('error', () => { observation.controlFailed = true; });
  return observation;
}

async function sentinel(node, root, generation) {
  const filename = path.join(root, 'adapterSentinel.cjs');
  await copyFile(path.join(here, 'fixtures/adapterSentinel.cjs'), filename);
  const child = spawn(node, [filename, generation], {
    cwd: root, env: { EKY_E2E: '1', SystemRoot: process.env.SystemRoot }, shell: false,
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const observation = observe(child);
  let pending;
  let error;
  const ready = new Promise((resolve, reject) => { pending = { kind: 'ready', resolve, reject }; });
  ready.catch(() => {});
  const fail = value => { error ??= value; pending?.reject(value); pending = undefined; };
  observation.capture.failed.catch(fail);
  child.on('message', value => {
    try {
      assert.ok(pending, 'unsolicitedSentinelResponse');
      assert.deepEqual(value, pending.kind === 'ready' ? { generation, kind: 'ready' }
        : { generation, kind: 'alive', nonce: pending.nonce });
      pending.resolve();
      pending = undefined;
    } catch (value) { fail(value); }
  });
  child.on('error', fail);
  child.on('exit', () => { if (pending) fail(new Error('sentinelExited')); });
  return { child, observation, ready,
    assertHealthy() {
      if (error) throw error;
      assert.equal(observation.spawnFailed, undefined);
      observation.capture.assertHealthy();
    },
    async challenge(deadline) {
      if (error) throw error;
      assert.equal(pending, undefined);
      const nonce = token();
      const response = new Promise((resolve, reject) => { pending = { resolve, reject, kind: 'alive', nonce }; });
      child.send({ generation, nonce, kind: 'challenge' }, value => { if (value) fail(value); });
      await beforeDeadline(response, deadline);
      if (error) throw error;
    },
    stop() { if (child.connected) child.send({ generation, nonce: token(), kind: 'stop' }, value => { if (value) fail(value); }); },
  };
}

async function runCase({ scenario, dotnet, adapter, assembly, node, electron }) {
  const tempBase = await realpath(tmpdir());
  const root = await mkdtemp(path.join(tempBase, 'eky-t3a-'));
  console.log(`Private evidence: ${root}`);
  const cwd = path.join(root, 'electronNormal');
  await mkdir(cwd);
  for (const name of ['tmp', 'profile']) await mkdir(path.join(cwd, name));
  for (const name of ['adapterContract.mjs', 'adapterControl.mjs', 'adapterDriver.mjs', 'adapterRootExitOrdering.mjs', 'boundedChildOutput.mjs'])
    await copyFile(path.join(here, name), path.join(cwd, name));
  for (const name of ['adapterFixture.cjs', 'adapterElectron.cjs', 'adapterLeaf.cjs', 'electronLaunchFailure.cjs'])
    await copyFile(path.join(here, 'fixtures', name), path.join(cwd, name));
  await copyFile(path.join(here, 'fixtures/adapterEntry.cjs'), path.join(cwd, 'electronDriver.cjs'));
  const generation = token();
  const nonce = token();
  const env = { ...experimentEnvironment(process.env, {
    root, scenario: 'electronNormal', node, electron,
    e2ePackage: path.join(e2e, 'package.json'), profile: path.join(cwd, 'profile'),
  }), DOTNET_ROOT: path.dirname(dotnet), EKY_T3C_ADAPTER: adapter,
    EKY_T3C_ROOT: root, EKY_T3C_TEMP_BASE: tempBase, EKY_T3C_GENERATION: generation,
    EKY_T3C_NONCE: token(), EKY_T3C_CASE: scenario, EKY_T3C_NODE: node };
  const deadline = performance.now() + outerObservationBudget;
  let witness;
  let child;
  let observation;
  let emergency;
  let intervention = false;
  let failure;
  let failureError;
  let inner;
  let outer;
  let phase = 'sentinelBefore';
  let sentinelBefore = false;
  let sentinelAfter = false;
  let sentinelStopped = false;
  try {
    witness = await sentinel(node, root, generation);
    await beforeDeadline(witness.ready, deadline);
    await witness.challenge(deadline);
    sentinelBefore = true;
    phase = 'outerOwner';
    child = spawn(dotnet, [assembly, node, root, 'electronNormal', nonce], {
      cwd, env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    observation = observe(child);
    emergency = setTimeout(() => {
      if (!observation.closed) { intervention = true; child.kill(); }
    }, Math.max(1, deadline - performance.now()));
    const exit = await beforeDeadline(observation.capture.guard(observation.done), deadline);
    phase = 'terminalValidation';
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.equal(intervention, false);
    assert.equal(observation.spawnFailed, undefined);
    observation.capture.assertHealthy();
    outer = validateTerminal(await jsonFile(path.join(cwd, 'terminal.json')), 'electronNormal', nonce);
    assert.equal(outer.reason, 'naturalExit', 'outerEmergencyCannotAcceptInnerTrial');
    inner = validateCaseEvidence(await jsonFile(path.join(cwd, 'adapter-evidence.json')), scenario, generation);
    phase = 'sentinelAfter';
    await witness.challenge(deadline);
    sentinelAfter = true;
  } catch (error) {
    failure = 'adapterExperimentFailed';
    failureError = error;
  } finally {
    if (child && !observation.closed) {
      intervention = true;
      try {
        child.stdin.end('S');
        await beforeDeadline(observation.done, deadline);
      }
      catch {
        // Still-open direct owner handle only. Kill-on-close is containment, not a pass.
        if (!observation.closed) child.kill();
        try { await beforeDeadline(observation.done, performance.now() + 3_000); }
        catch { failure = 'outerOwnerExitUnverified'; }
      }
    }
    clearTimeout(emergency);
    if (witness) {
      if (!sentinelAfter && !witness.observation.closed) {
        try { await witness.challenge(deadline); sentinelAfter = true; } catch { /* Failure retained. */ }
      }
      try {
        witness.stop();
        assert.deepEqual(await beforeDeadline(witness.observation.done, deadline), { code: 0, signal: null });
        witness.assertHealthy();
        sentinelStopped = true;
      } catch (error) {
        failureError ??= error;
        failure ??= 'sentinelExitUnverified';
        if (!witness.observation.closed) witness.child.kill();
        try { await beforeDeadline(witness.observation.done, performance.now() + 3_000); }
        catch { failure = 'sentinelEmergencyExitUnverified'; }
      }
    }
  }
  if (failureError) await writeFile(path.join(root, 'runner-error.private.log'),
    boundedFailureDetails(failureError), { flag: 'wx', mode: 0o600 });
  if (intervention) failure ??= 'outerIntervention';
  const result = { schemaVersion: 1, scenario, generation, passed: !failure,
    failure: failure ?? null, phase, outerIntervention: intervention,
    sentinelBefore, sentinelAfter, sentinelStopped, outer, inner };
  await writeFile(path.join(root, 'adapter-result.private.json'), JSON.stringify(result, null, 2), { flag: 'wx' });
  await writeFile(path.join(root, 'outer-output.private.log'), observation?.capture.output ?? Buffer.alloc(0), { flag: 'wx', mode: 0o600 });
  return { result, root };
}

async function main() {
  assert.equal(process.platform, 'win32');
  assert.equal(process.env.EKY_E2E, '1', 'explicitExperimentOptInRequired');
  assert.equal(process.argv[2], '--dotnet');
  assert.equal(process.argv[4], '--adapter');
  const dotnet = await realpath(process.argv[3]);
  const adapter = await realpath(process.argv[5]);
  const scenarios = process.argv.slice(6);
  assert.ok(scenarios.length && scenarios.every(value => adapterCases.includes(value)));
  assert.equal(new Set(scenarios).size, scenarios.length);
  const node = await realpath(process.execPath);
  const electron = await realpath(desktopRequire('electron'));
  const assembly = path.join(e2e, '.artifacts/t3a-native/bin/Eky.ProcessOwnershipExperiment/release/Eky.ProcessOwnershipExperiment.dll');
  await stat(assembly);
  const hashes = {};
  for (const [name, file] of [['outer', assembly], ['adapter', adapter],
    ['adapterAssembly', path.join(path.dirname(adapter), 'Eky.ProcessOwnershipAdapter.dll')],
    ['adapterRuntime', path.join(path.dirname(adapter), 'Eky.ProcessOwnershipAdapter.runtimeconfig.json')],
    ['adapterDependencies', path.join(path.dirname(adapter), 'Eky.ProcessOwnershipAdapter.deps.json')],
    ['node', node], ['electron', electron]])
    hashes[name] = createHash('sha256').update(await readFile(file)).digest('hex');
  for (const scenario of scenarios) {
    console.log(`Starting adapter experiment: ${scenario}`);
    const { result, root } = await runCase({ scenario, dotnet, adapter, assembly, node, electron });
    await writeFile(path.join(root, 'binary-hashes.private.json'), JSON.stringify(hashes), { flag: 'wx' });
    console.log(`${scenario}: ${result.passed ? 'PASS (experiment only)' : 'FAIL (evidence retained)'}`);
    if (!result.passed) { process.exitCode = 1; break; }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => { console.error('adapterRunnerFailed'); process.exitCode = 1; });
