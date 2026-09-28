import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, request as requestFactory } from '@playwright/test';
import config from '../../playwright.config.js';
import { runIsolatedBackendTest } from '../../src/fixtures/isolatedBackendTest.js';
import { runIsolatedWebTest } from '../../src/fixtures/isolatedWebTest.js';
import { runOwnedChromiumWorker } from '../../src/fixtures/runOwnedChromiumWorker.js';
import { claimChromiumWorker } from '../../src/fixtures/chromiumWorkerAdmission.js';
import { createE2eRunRoot } from '../../src/environment/createE2eRunRoot.js';
import { createE2eWorkerPaths } from '../../src/environment/createE2eWorkerPaths.js';
import { createE2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import { removeE2eRunRoot } from '../../src/environment/removeE2eRunRoot.js';
import { reserveLoopbackPort } from '../../src/environment/reserveLoopbackPort.js';
import { waitForLoopbackPortRelease } from '../../src/environment/waitForLoopbackPortRelease.js';
import { collectBackendFailureArtifacts } from '../../src/environment/collectBackendFailureArtifacts.js';
import { collectWebFailureArtifacts } from '../../src/environment/collectWebFailureArtifacts.js';
import { installE2eBrowserNetworkBoundary } from '../../src/environment/e2eBrowserNetworkBoundary.js';
import { startE2eBackendProcess } from '../../src/environment/startE2eBackendProcess.js';
import { startE2eWebProcess } from '../../src/environment/startE2eWebProcess.js';
import { startOwnedLinuxBackend } from '../../src/environment/startOwnedLinuxBackend.js';
import { startOwnedLinuxVite } from '../../src/environment/startOwnedLinuxVite.js';
import { startOwnedLinuxChromium } from '../../src/environment/startOwnedLinuxChromium.js';
import { exactKeys, failureExit, isNonce, waitWithin } from './pidNamespaceContract.mjs';
import { guardLinuxService, serviceDeadlines, servicePath } from './linuxServiceContract.mjs';
import { inspectServicePath } from './linuxServiceConfiguration.mjs';
import { consumerLossCase, linuxConsumerPhases, requireConsumerLoss } from './linuxConsumerLossContract.mjs';
import { consumerLossRecords, waitConsumerLossRecord } from './linuxConsumerLossRecords.mjs';
import { validateConsumerLossOutcome } from './linuxConsumerLossOutcome.mjs';
import { openLinuxConsumerExchange } from './linuxConsumerExchange.mjs';
import { createLinuxConsumerCommandGate } from './linuxConsumerCommandGate.mjs';
import { createLinuxConsumerSessionProbe } from './linuxConsumerSessionProbe.mjs';
import { createLinuxConsumerAttachments } from './linuxConsumerAttachments.mjs';

async function waitForLoss(probe, deadline) {
  while (!probe.readState().lost) {
    deadline.check('work');
    await waitWithin(new Promise(resolve => setTimeout(resolve,
      Math.min(25, deadline.remaining('work')))), deadline, 'work');
  }
}

// This direct leaf uses the real compositions, not a nested Playwright runner.
// Normal CI separately proves runner scheduling, reporting and retry behavior.
export async function runLinuxConsumerLossActor(input) {
  let phase = 'context';
  try {
    return await executeConsumerLoss(input, value => {
      requireConsumerLoss(linuxConsumerPhases.includes(value)); phase = value;
    });
  } catch {
    throw Object.assign(new Error('E2E_LINUX_CONSUMER_LOSS_UNVERIFIED'), { phase });
  }
}

async function executeConsumerLoss(input, step) {
  const identity = guardLinuxService();
  requireConsumerLoss(exactKeys(input, ['root', 'nonce', 'caseId', 'repositoryRoot', 'auxiliaryRoot', 'until']) &&
    isNonce(input.nonce) && typeof input.until === 'string' && /^[1-9][0-9]{0,23}$/u.test(input.until));
  const selected = consumerLossCase(input.caseId);
  inspectServicePath(input.repositoryRoot, true);
  const auxiliaryRoot = inspectServicePath(input.auxiliaryRoot, true);
  const metadata = lstatSync(auxiliaryRoot);
  requireConsumerLoss(posix.dirname(auxiliaryRoot) === posix.join(realpathSync(tmpdir()), 'eky-e2e') &&
    /^run-[A-Za-z0-9-]+$/u.test(posix.basename(auxiliaryRoot)) && metadata.uid === identity.uid &&
    metadata.gid === identity.gid && (metadata.mode & 0o7777) === 0o700);
  const now = process.hrtime.bigint();
  requireConsumerLoss(Number.isSafeInteger(config.timeout) && config.timeout > 0 &&
    Number.isSafeInteger(config.globalTimeout) && config.globalTimeout >= config.timeout && config.workers === 1 &&
    BigInt(input.until) > now && BigInt(input.until) <= now + BigInt(config.timeout) * 1_000_000n);
  const deadline = serviceDeadlines({ startUntil: input.until, workUntil: input.until });
  const exchange = openLinuxConsumerExchange({ root: servicePath(input.root), identity: { uid: identity.uid, gid: identity.gid },
    nonce: input.nonce, caseId: input.caseId, role: 'caller', records: consumerLossRecords(input.caseId) });
  const commands = createLinuxConsumerCommandGate();
  step('setup');
  const probes = Object.fromEntries(selected.profiles.map(profile => [profile,
    createLinuxConsumerSessionProbe({ caseId: input.caseId, profile, repositoryRoot: input.repositoryRoot, exchange, commands })]));
  const launches = Object.fromEntries(selected.profiles.map(profile => [profile, 0]));
  let testRoot;
  let workerRoot;
  let workerReport;
  let refusal;
  let bodyReached = false;
  const original = new Error('E2E_LINUX_CONSUMER_BODY_FAILURE');
  const attachmentRoot = posix.join(auxiliaryRoot, 'attachments');
  mkdirSync(attachmentRoot, { mode: 0o700 });
  const attachments = createLinuxConsumerAttachments({ root: attachmentRoot, readTestRoot: () => testRoot });
  const testInfo = { title: 'PROC-CONSUMER-001 bounded ownership loss', timeout: config.timeout,
    status: 'passed', expectedStatus: 'passed', attach: attachments.attach };
  const admissionDirectory = posix.join(auxiliaryRoot, 'admission');
  const workerInfo = { parallelIndex: 0, project: { outputDir: admissionDirectory, timeout: config.timeout },
    config: { globalTimeout: config.globalTimeout, workers: config.workers } };
  const count = (profile, start) => input => {
    step(`${profile}Start`);
    launches[profile]++;
    requireConsumerLoss(launches[profile] === 1);
    return start({ ...input, repositoryRoot: inputRoot }, probes[profile].dependencies);
  };
  const inputRoot = input.repositoryRoot;
  const startBackend = input => startE2eBackendProcess(input, {
    startOwned: count('backend', startOwnedLinuxBackend),
  });
  const dependencies = {
    collectBackendFailureArtifacts, createE2eFixtureLifetime, createE2eWorkerPaths, requestFactory,
    removeE2eRunRoot, reserveLoopbackPort, waitForLoopbackPortRelease, startE2eBackendProcess: startBackend,
    createE2eRunRoot() { requireConsumerLoss(testRoot === undefined); testRoot = createE2eRunRoot(); return testRoot; },
  };
  const workerDependencies = { claimChromiumWorker, removeE2eRunRoot,
    createE2eRunRoot() { requireConsumerLoss(workerRoot === undefined); workerRoot = createE2eRunRoot(); return workerRoot; },
    startOwnedChromium(input, playwright) {
      step('chromiumStart');
      launches.chromium++;
      requireConsumerLoss(launches.chromium === 1);
      return startOwnedLinuxChromium({ ...input, repositoryRoot: inputRoot }, playwright, probes.chromium.dependencies);
    },
    report(value) { requireConsumerLoss(workerReport === undefined); workerReport = value; },
  };
  async function body(harness) {
    step('readiness');
    requireConsumerLoss(!bodyReached && harness.runRoot === testRoot);
    bodyReached = true;
    requireConsumerLoss((await harness.api.get('/health')).ok());
    if (harness.page) {
      deadline.check('work');
      await harness.page.getByRole('heading', { name: 'Asiakkaat', exact: true }).waitFor({ state: 'visible',
        timeout: Math.min(config.expect.timeout, deadline.remaining('work')) });
    }
    for (const profile of selected.profiles) probes[profile].requireHealthy();
    await commands.drain(deadline, 'work');
    if (selected.cause === 'caller') commands.seal();
    step('faultGrant');
    exchange.publish('ready.json', { testRoot, workerRoot: workerRoot ?? null,
      admissionDirectory: workerRoot === undefined ? null : admissionDirectory });
    const grant = await waitConsumerLossRecord(exchange, 'grant.json', deadline, 'work');
    requireConsumerLoss(grant.caseId === input.caseId);
    for (const profile of selected.profiles) probes[profile].requireHealthy();
    step('fault');
    if (selected.cause === 'caller') {
      commands.verifySealed();
      for (const profile of selected.profiles) probes[profile].arm();
      requireConsumerLoss(selected.profiles.every(profile => !probes[profile].readState().lost));
      commands.verifySealed();
      deadline.check('work');
      process.exit(failureExit);
    }
    const probe = probes[selected.profile];
    probe.arm();
    step('lossObservation');
    await waitForLoss(probe, deadline);
    step('consumerRefusal');
    if (selected.profile === 'backend') {
      await assert.rejects(harness.restartBackend());
      await assert.rejects(harness.restartBackend(), { message: 'E2E backend cannot be restarted.' });
      requireConsumerLoss(launches.backend === 1);
      refusal = 'backendRestart';
    } else if (selected.profile === 'vite') {
      const first = harness.web.stop();
      requireConsumerLoss(harness.web.stop() === first);
      await assert.rejects(first);
      await assert.rejects(harness.web.stop());
      refusal = 'cachedViteStop';
    }
    step('fixtureTeardown');
    throw original;
  }

  let caught;
  try {
    if (selected.profile === 'backend') {
      await runIsolatedBackendTest({ e2eContainmentTimeoutMilliseconds: undefined, e2eFaultPlan: { kind: 'none' } },
        body, testInfo, dependencies);
    } else {
      await runOwnedChromiumWorker({ playwright: { chromium } }, async browser => {
        const context = await browser.newContext({ locale: config.use.locale, timezoneId: config.use.timezoneId });
        try {
          const page = await context.newPage();
          await runIsolatedWebTest({ context, page, e2eContainmentTimeoutMilliseconds: undefined,
            e2eFaultPlan: { kind: 'none' } }, body, testInfo, { ...dependencies, collectWebFailureArtifacts,
            installE2eBrowserNetworkBoundary, startE2eWebProcess: input => startE2eWebProcess(input, {
              startOwned: count('vite', startOwnedLinuxVite),
            }) });
        } finally {
          // The real web fixture closes and accounts for the context. This also
          // covers failures before that fixture owns it, without masking them.
          try { await context.close(); } catch { /* The fixture's receipt remains authoritative. */ }
        }
      }, workerInfo, workerDependencies);
    }
  } catch (error) { caught = error; }
  requireConsumerLoss(caught === original && bodyReached);
  if (selected.profile === 'chromium') {
    step('replacementRefusal');
    const before = { ...launches };
    const priorRoot = workerRoot;
    await assert.rejects(runOwnedChromiumWorker({ playwright: { chromium } }, async () => {
      throw new Error('E2E_LINUX_CONSUMER_UNEXPECTED_REPLACEMENT');
    }, workerInfo, workerDependencies), { message: 'E2E_CHROMIUM_WORKER_ADMISSION_REFUSED' });
    requireConsumerLoss(workerRoot === priorRoot && selected.profiles.every(profile => launches[profile] === before[profile]));
    refusal = 'chromiumReplacement';
  }
  step('commandsClose');
  await commands.drain(deadline, 'wrapper');
  commands.seal(); commands.verifySealed();
  const affected = probes[selected.profile].readState();
  step('outcome');
  const fixtureCleanup = attachments.readServiceCleanup();
  const outcome = validateConsumerLossOutcome({ caseId: input.caseId, bodyPreserved: caught === original,
    refusal, fixtureCleanup, workerCleanup: workerReport ?? null, launches,
    passive: affected.passive && !affected.gateFailed, commandsClosed: true }, input.caseId);
  requireConsumerLoss(existsSync(testRoot) === (fixtureCleanup.runRoot === 'retained'));
  if (workerRoot !== undefined) {
    const retained = workerReport.workerRoot === 'retained';
    requireConsumerLoss(existsSync(workerRoot) === retained &&
      existsSync(posix.join(admissionDirectory, '.eky-chromium-worker-pending.json')) === retained);
  }
  step('report');
  exchange.publish('result.json', outcome);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const names = ['root', 'nonce', 'caseId', 'repositoryRoot', 'auxiliaryRoot', 'until'];
    const args = process.argv.slice(2);
    requireConsumerLoss(args.length === names.length && args.every((value, index) => value.startsWith(`--${names[index]}=`)));
    await runLinuxConsumerLossActor(Object.fromEntries(names.map((name, index) => [name, args[index].slice(name.length + 3)])));
  } catch (error) {
    process.stderr.write('EKY_LINUX_CONSUMER_FAILURE ' + JSON.stringify({ schemaVersion: 1,
      operation: 'consumerLoss', phase: linuxConsumerPhases.includes(error?.phase) ? error.phase : 'context',
      errorCode: 'E2E_LINUX_CONSUMER_LOSS_UNVERIFIED' }) + '\n');
    process.exitCode = 1;
  }
}
