import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, mkdir, mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { experimentCases, experimentEnvironment, maximumEvidenceBytes, validateTerminal } from './experimentContract.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const e2eRoot = path.resolve(here, '../..');
const requireE2e = createRequire(path.join(e2eRoot, 'package.json'));
const requireDesktop = createRequire(path.resolve(e2eRoot, '../desktop/package.json'));
const observationBudgetMilliseconds = 35_000;

async function readJson(filename) {
  const info = await stat(filename);
  assert.ok(info.isFile() && info.size <= maximumEvidenceBytes);
  return JSON.parse(await readFile(filename, 'utf8'));
}

async function waitForJson(filename, owner) {
  const deadline = performance.now() + observationBudgetMilliseconds;
  while (performance.now() < deadline) {
    try { return await readJson(filename); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    assert.equal(owner.closed, false, 'sessionEndedBeforeEvidence');
    await delay(20);
  }
  throw new Error('evidenceObservationExpired');
}

function observeOwner(child) {
  const owner = { closed: false, diagnostics: [], bytes: 0 };
  owner.done = new Promise(resolve => {
    child.once('error', () => { owner.spawnError = true; });
    child.once('close', (code, signal) => { owner.closed = true; resolve({ code, signal }); });
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
    const remaining = maximumEvidenceBytes - owner.bytes;
    if (remaining > 0) {
      const kept = chunk.subarray(0, remaining);
      owner.diagnostics.push(kept);
      owner.bytes += kept.length;
    }
  });
  child.stdin.on('error', () => { owner.controlError = true; });
  return owner;
}

async function boundedObservation(promise, milliseconds = observationBudgetMilliseconds) {
  const controller = new AbortController();
  try {
    return await Promise.race([
      promise,
      delay(milliseconds, null, { signal: controller.signal }).then(() => { throw new Error('ownerObservationExpired'); }),
    ]);
  } finally { controller.abort(); }
}

async function runCase({ root, scenario, node, electron, e2ePackage, dotnet, assembly }) {
  const directory = path.join(root, scenario);
  await mkdir(directory);
  const profile = path.join(directory, 'profile');
  await mkdir(profile);
  await mkdir(path.join(directory, 'tmp'));
  for (const name of ['nodeTree.cjs', 'electronMain.cjs', 'electronDriver.cjs', 'electronLaunchFailure.cjs'])
    await copyFile(path.join(here, 'fixtures', name), path.join(directory, name));
  const nonce = randomBytes(32).toString('hex');
  const child = spawn(dotnet, [assembly, node, root, scenario, nonce], {
    cwd: directory,
    env: experimentEnvironment(process.env, { root, scenario, node, electron, e2ePackage, profile }),
    windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const owner = observeOwner(child);
  const emergency = setTimeout(() => {
    if (!owner.closed) { owner.emergencyRequested = true; child.kill(); }
  }, observationBudgetMilliseconds);
  let terminal;
  let workload;
  let failure;
  let originalError;
  let terminalAccepted = false;
  let phase = 'ownership';
  try {
    await boundedObservation((async () => {
      const owned = await waitForJson(path.join(directory, 'owned.json'), owner);
      assert.deepEqual(owned, { schemaVersion: 1, nonce, assignedBeforeResume: true });
      phase = 'workload';
      workload = await waitForJson(path.join(directory, 'workload.json'), owner);
      assert.equal(workload.case, scenario);
      assert.equal(workload.stage, 'ready');
      if (scenario !== 'nodeStop') {
        phase = 'rootExit';
        const rootExit = await waitForJson(path.join(directory, 'root-exited.json'), owner);
        assert.equal(rootExit.nonce, nonce);
      }
      if (scenario !== 'electronNormal') child.stdin.end('S');
      phase = 'terminal';
      const exit = await boundedObservation(owner.done);
      terminal = validateTerminal(await readJson(path.join(directory, 'terminal.json')), scenario, nonce);
      assert.equal(exit.signal, null);
      assert.equal(exit.code, scenario === 'nodeStop' || scenario === 'nodeRootFailure' ? 1 : 0);
      assert.equal(owner.spawnError, undefined);
      assert.equal(owner.emergencyRequested, undefined);
    })());
    terminalAccepted = true;
  } catch (error) {
    failure = 'experimentAssertionFailed';
    originalError = String(error.stack ?? error).slice(0, maximumEvidenceBytes);
  } finally {
    // This is a cooperative request to the already-owned Job, never a PID/name kill.
    if (!owner.closed && !child.stdin.writableEnded) child.stdin.end('S');
    try { await boundedObservation(owner.done); }
    catch {
      failure = 'ownerExitUnverified';
      // The directly spawned owner's still-open process handle only. This is
      // emergency containment, never proof of descendant absence or a pass.
      if (!owner.closed) { owner.emergencyRequested = true; child.kill(); }
      try { await boundedObservation(owner.done); } catch { failure = 'emergencyOwnerExitUnverified'; }
    }
    clearTimeout(emergency);
    try {
      if (originalError) await boundedObservation(writeFile(path.join(directory, 'runner-error.private.log'), originalError, { flag: 'wx' }), 2000);
      await boundedObservation(writeFile(path.join(directory, 'owner-output.private.log'), Buffer.concat(owner.diagnostics), { flag: 'wx' }), 2000);
    } catch { failure ??= 'diagnosticWriteFailed'; }
  }
  if (!terminal) {
    try { terminal = await boundedObservation(readJson(path.join(directory, 'terminal.json')), 2000); }
    catch { /* Missing terminal is a failure, never proof of cleanup. */ }
  }
  if (owner.emergencyRequested) { failure ??= 'emergencyOwnerTermination'; terminalAccepted = false; }
  return {
    scenario, passed: !failure, failure, failurePhase: failure ? phase : undefined,
    ownerClosed: owner.closed, emergencyOwnerTerminationRequested: Boolean(owner.emergencyRequested),
    cleanup: terminalAccepted ? 'processTreeAbsent' : 'cleanupUnverified',
    terminalAccepted, terminal, workload,
  };
}

async function main() {
  assert.equal(process.platform, 'win32', 'windowsRequired');
  assert.equal(process.env.EKY_E2E, '1', 'explicitExperimentOptInRequired');
  assert.equal(process.argv[2], '--dotnet');
  const dotnet = await realpath(process.argv[3]);
  const scenarios = process.argv.slice(4);
  assert.ok(scenarios.length > 0 && new Set(scenarios).size === scenarios.length);
  assert.ok(scenarios.every(scenario => experimentCases.includes(scenario)));
  const assembly = path.join(e2eRoot, '.artifacts/t3a-native/bin/Eky.ProcessOwnershipExperiment/release/Eky.ProcessOwnershipExperiment.dll');
  await stat(assembly);
  const node = await realpath(process.execPath);
  const electron = await realpath(requireDesktop('electron'));
  requireE2e('@playwright/test');
  const root = await mkdtemp(path.join(await realpath(tmpdir()), 'eky-t3a-'));
  console.log(`Evidence (private): ${root}`);
  const results = [];
  const assemblySha256 = createHash('sha256').update(await readFile(assembly)).digest('hex');
  for (const scenario of scenarios) {
    console.log(`Starting ${scenario}`);
    const result = await runCase({ root, scenario, node, electron, e2ePackage: path.join(e2eRoot, 'package.json'), dotnet, assembly });
    results.push(result);
    await boundedObservation(writeFile(path.join(root, 'summary.json'), JSON.stringify({ schemaVersion: 1, assemblySha256, results }, null, 2)), 2000);
    console.log(`${scenario}: ${result.passed ? 'PASS (feasibility only)' : 'FAIL; evidence retained'}`);
    if (!result.passed) { process.exitCode = 1; break; }
  }
  // Preserve this bounded synthetic evidence; never erase an unverified process root.
}

main().catch(() => { console.error('experimentRunnerFailed'); process.exitCode = 1; });
