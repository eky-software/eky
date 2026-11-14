import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { setupPackagedPilotSeries } from './packagedPilotSeriesSetup.mjs';
import { packagedSeriesManifestVariable } from '../../desktop/scripts/packagedPilotSeries.mjs';
import { createRunnerFailureSink } from '../../../test-reporters/runnerFailureEvidence.mjs';

const readManifest = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'));
const root = readManifest('../../../package.json');
const e2e = readManifest('../package.json');
const desktop = readManifest('../../desktop/package.json');
const backend = readManifest('../../backend/package.json');
test('the actual Playwright loader discovers the phase-observed deletion case without starting a runtime', { timeout: 5000 }, () => {
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)),
    'test', '--project=electron-development', 'tests/electron/workspaceDeletionExecution.spec.ts',
    '--grep', 'DESK-DELETE-RECOVERY-001', '--list'], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env, encoding: 'utf8', windowsHide: true,
    timeout: 4000, maxBuffer: 128 * 1024,
  });
  if (result.error !== undefined || result.signal !== null || result.status !== 0) {
    throw new Error('WORKSPACE_DELETION_PLAYWRIGHT_DISCOVERY_FAILED', {
      cause: result.error ?? new Error((result.stderr || result.stdout).slice(0, 4096)),
    });
  }
  assert.match(result.stdout, /DESK-DELETE-RECOVERY-001/u);
  assert.match(result.stdout, /Total: 1 test in 1 file/u);
});

for (const kind of ['local', 'github']) {
  test(`the real Playwright loader invokes parent phase capture and private delivery with ${kind} binding`, { timeout: 5000 }, async t => {
    const fixtureRoot = realpathSync(mkdtempSync(join(tmpdir(), 'eky-phase-loader-')));
    let complete = false;
    t.after(() => { if (complete) rmSync(fixtureRoot, { recursive: true, force: true }); });
    try {
      const job = { runId: '98765', attempt: '3', job: 'phase-loader', jobKey: 'phase-loader-0', sourceRevision: 'a'.repeat(40) };
      const binding = kind === 'local' ? { kind } : { kind, ...job, jobKeySource: 'explicit' };
      const env = { ...process.env, EKY_E2E: '1', TEMP: fixtureRoot, TMP: fixtureRoot, TMPDIR: fixtureRoot };
      for (const name of Object.keys(env)) {
        if (/^(?:NODE_TEST_CONTEXT|CI|GITHUB_.*|EKY_EVIDENCE_JOB_KEY|DEBUG.*|PW.*|PLAYWRIGHT_.*)$/iu.test(name)) delete env[name];
      }
      if (kind === 'github') Object.assign(env, { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: job.runId,
        GITHUB_RUN_ATTEMPT: job.attempt, GITHUB_JOB: job.job, EKY_EVIDENCE_JOB_KEY: job.jobKey, GITHUB_SHA: job.sourceRevision });
      writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      writeFileSync(join(fixtureRoot, 'playwright.config.mjs'), [
        'export default { testDir: ".", testMatch: "phase.spec.ts", workers: 1, retries: 0, timeout: 1000,',
        'outputDir: "./run-33333333-3333-4333-8333-333333333333",',
        `reporter: [[${JSON.stringify(fileURLToPath(new URL('./safeCiReporter.mjs', import.meta.url)))}, { silent: true }]] };`,
      ].join('\n'));
      writeFileSync(join(fixtureRoot, 'phase.spec.ts'), [
        'import assert from "node:assert/strict";',
        'import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";',
        'import { basename, dirname, join } from "node:path";',
        `import { test } from ${JSON.stringify(new URL('../node_modules/@playwright/test/index.mjs', import.meta.url).href)};`,
        `import { selectWorkspaceDeletionPhaseObservation } from ${JSON.stringify(new URL('../src/fixtures/captureWorkspaceDeletionFailure.ts', import.meta.url).href)};`,
        `import { createWorkspaceDeletionRawPhaseRecorder, WORKSPACE_DELETION_MAIN_PHASE_COVERAGE } from ${JSON.stringify(new URL('../../desktop/e2e/workspaceDeletionPhaseObservation.ts', import.meta.url).href)};`,
        `import { parsePhaseHandoffEnvelope, validatePhaseHandoffCollector, PHASE_WIRE_LIMITS } from ${JSON.stringify(new URL('../../desktop/e2e/workspaceDeletionPhaseHandoff.ts', import.meta.url).href)};`,
        'test("synthetic parent phase loader contract, not a worker or Electron journey", () => {',
        '  throw new Error("PHASE_LOADER_CONTRACT_BODY_MUST_NOT_RUN");',
        '});',
        // Top-level awaits execute under the real transform hooks without starting a test worker.
        '{',
        `  const outputDir = ${JSON.stringify(join(fixtureRoot, 'run-33333333-3333-4333-8333-333333333333'))};`,
        '  const attemptDirectory = join(outputDir, "synthetic-loader-retry0");',
        '  mkdirSync(attemptDirectory, { recursive: true });',
        '  const info = { retry: 0, repeatEachIndex: 0, project: { outputDir },',
        '    outputPath: name => join(attemptDirectory, name) };',
        '  const runtimeInstanceId = "11111111-1111-4111-8111-111111111111";',
        '  const recorder = createWorkspaceDeletionRawPhaseRecorder(runtimeInstanceId, () => 1, WORKSPACE_DELETION_MAIN_PHASE_COVERAGE);',
        '  recorder.observePhase(runtimeInstanceId, { phase: "preparation", event: "entered", callId: 1 });',
        '  const raw = recorder.freeze();',
        '  let releaseCapture, reads = 0;',
        '  const pending = new Promise(resolve => { releaseCapture = resolve; });',
        '  const application = { evaluate() { reads++; return pending; } };',
        '  const selected = selectWorkspaceDeletionPhaseObservation({ application, runtimeInstanceId,',
        '    scenarioId: "DESK-DELETE-RECOVERY-001", testInfo: info });',
        '  selected.beginClose(application, runtimeInstanceId);',
        '  assert.equal(reads, 1);',
        '  releaseCapture(raw);',
        '  await pending;',
        '  selected.finishClose(application, runtimeInstanceId);',
        '  const destination = info.outputPath("failure.private.json");',
        '  assert.equal(await selected.reportFailure(false), "notRequired");',
        '  assert.equal(existsSync(destination), false);',
        '  assert.equal(await selected.reportFailure(true), "recorded");',
        '  const bytes = readFileSync(destination);',
        '  assert.equal(bytes.length <= PHASE_WIRE_LIMITS.bytes, true);',
        '  const envelope = parsePhaseHandoffEnvelope(bytes);',
        '  assert.equal(envelope?.availability, "captured");',
        '  assert.deepEqual(envelope.snapshot, raw.snapshot);',
        '  assert.deepEqual(envelope.selection, { runtimeInstanceId, scenarioId: "DESK-DELETE-RECOVERY-001",',
        '    testAttempt: info.retry, repeatEachIndex: info.repeatEachIndex });',
        `  assert.deepEqual(envelope.delivery.binding, ${JSON.stringify(binding)});`,
        '  const relativePath = `${basename(info.project.outputDir)}/${basename(dirname(destination))}/failure.private.json`;',
        '  assert.equal(envelope.delivery.relativePath, relativePath);',
        `  const job = ${JSON.stringify(job)};`,
        kind === 'github'
          ? '  assert.deepEqual(validatePhaseHandoffCollector(bytes, job, relativePath), envelope);'
          : '  assert.equal(validatePhaseHandoffCollector(bytes, job, relativePath), undefined);',
        '  assert.equal(validatePhaseHandoffCollector(bytes, { ...job, attempt: "4" }, relativePath), undefined);',
        '  assert.equal(await selected.reportFailure(true), "deliveryFailed");',
        '  assert.deepEqual(readFileSync(destination), bytes);',
        `  writeFileSync(${JSON.stringify(join(fixtureRoot, 'loader-complete.private.json'))}, JSON.stringify({ binding: ${JSON.stringify(kind)}, invocation: "loader" }));`,
        '}',
      ].join('\n'));
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url)),
        'test', '--config', join(fixtureRoot, 'playwright.config.mjs'), '--list'], {
        cwd: fixtureRoot, env, encoding: 'utf8', windowsHide: true, timeout: 4000, maxBuffer: 128 * 1024,
      });
      if (result.error !== undefined || result.signal !== null || result.status !== 0) {
        throw new Error('WORKSPACE_DELETION_PHASE_LOADER_CHILD_FAILED', {
          cause: result.error ?? new Error((result.stderr || result.stdout).slice(0, 4096)),
        });
      }
      // Import-only discovery cannot produce this receipt after the actual parent calls.
      assert.deepEqual(JSON.parse(readFileSync(join(fixtureRoot, 'loader-complete.private.json'), 'utf8')),
        { binding: kind, invocation: 'loader' });
      complete = true;
    } catch (error) {
      const sink = createRunnerFailureSink();
      sink.record({ runner: 'node', phase: 'workspaceDeletionPhaseLoader', testName: t.name, attempt: 0, error });
      await sink.flush();
      throw new Error('WORKSPACE_DELETION_PLAYWRIGHT_LOADER_FAILED');
    }
  });
}
const preparations = [
  'pnpm --filter @eky/desktop e2e:prepare-electron-runtime',
  'pnpm --filter @eky/e2e e2e:prepare-owner',
  'pnpm --filter @eky/permissions build',
  'pnpm --filter @eky/auth build',
  'pnpm --filter @eky/backend e2e:build',
  'pnpm --filter @eky/web build',
  'pnpm --filter @eky/desktop build',
  'pnpm --filter @eky/desktop e2e:build',
  'pnpm --filter @eky/desktop e2e:prepare-backend',
];
const projects = '--project=system-api --project=web-chromium --project=electron-development';
const wiringContractCommand = 'node --test --test-reporter=../../test-reporters/nodeFailureReporter.mjs scripts/e2e-command-wiring.test.mjs';
const contractCommand = 'node --test --test-reporter=../../test-reporters/nodeFailureReporter.mjs scripts/windowsBackendOwnerBuild.test.mjs scripts/safeCiReporter.test.mjs scripts/compositionPreflightRelay.test.mjs scripts/electronLifecycleProjection.test.mjs scripts/workspaceDeletionFailureEvidence.test.mjs scripts/workspaceAdoptionProofEvidence.test.mjs scripts/e2eRunArtifacts.test.mjs experiments/processOwnership/playwrightElectronLaunch.test.mjs experiments/processOwnership/playwrightElectronProcessKill.test.mjs experiments/processOwnership/adapterContract.test.mjs experiments/processOwnership/adapterControl.test.mjs experiments/processOwnership/adapterRootExitOrdering.test.mjs experiments/processOwnership/boundedChildOutput.test.mjs experiments/processOwnership/pidNamespaceContract.test.mjs experiments/processOwnership/runPidNamespaceExperiment.test.mjs experiments/processOwnership/managedNamespaceContract.test.mjs experiments/processOwnership/managedNamespaceControl.test.mjs experiments/processOwnership/managedNamespaceObservation.test.mjs experiments/processOwnership/managedNamespacePreflight.test.mjs experiments/processOwnership/managedNamespaceCommand.test.mjs experiments/processOwnership/managedNamespaceSession.test.mjs experiments/processOwnership/managedNamespaceResult.test.mjs experiments/processOwnership/runManagedNamespaceExperiment.test.mjs experiments/processOwnership/managedChromiumFailure.test.mjs experiments/processOwnership/managedChromiumActor.test.mjs experiments/processOwnership/linuxServiceContract.test.mjs experiments/processOwnership/linuxServiceControl.test.mjs experiments/processOwnership/linuxServiceSession.test.mjs';

function assertWiring(rootManifest, e2eManifest) {
  assert.equal(rootManifest.scripts.test, 'pnpm --recursive test');
  assert.equal(e2eManifest.scripts.test,
    [...preparations.slice(2, 4), wiringContractCommand, contractCommand, 'pnpm test:consumer-loss'].join(' && '));
  assert.equal(e2eManifest.scripts['test:consumer-loss'], consumerContractCommand);
  assert.equal(e2eManifest.scripts['linux:consumer:build'],
    'node experiments/processOwnership/linuxConsumerLossBuildCli.mjs');
  assert.equal(e2eManifest.scripts['linux:consumer:loss'],
    'node experiments/processOwnership/runLinuxConsumerLoss.mjs');
  assert.deepEqual(e2eManifest.scripts['e2e:electron:prepare'].split(' && '), preparations);
  assert.equal(e2eManifest.scripts['e2e:prepare-owner'], 'node scripts/prepare-windows-backend-owner.mjs');
  assert.deepEqual(e2eManifest.scripts['e2e:prepare'].split(' && '), preparations.slice(1, 5));
  assert.equal(e2eManifest.scripts['e2e:packaged:legacy'],
    'pnpm e2e:prepare && pnpm --filter @eky/desktop installer:supervisor:build && pnpm --filter @eky/desktop package:windows:pilot && playwright test --config playwright.packaged-legacy.config.ts');
  assert.equal(e2eManifest.scripts['e2e:electron:evidence'],
    'pnpm e2e:electron:prepare && node --test --test-concurrency=1 --test-reporter=../../test-reporters/nodeFailureReporter.mjs ../../test-reporters/tests/electronDevelopmentFailureEvidenceOpenPgp.test.mjs');
  for (const tag of ['security', 'fault']) {
    assert.equal(rootManifest.scripts[`test:e2e:${tag}`], `pnpm --filter @eky/e2e e2e:${tag}`);
    assert.equal(
      e2eManifest.scripts[`e2e:${tag}`],
      `pnpm e2e:electron:prepare && playwright test ${projects} --grep @${tag}`,
    );
  }
}

test('Node contract discovery requires both shared builds before the real loader', () => {
  const [permissionsBuild, authBuild] = preparations.slice(2, 4);
  const command = e2e.scripts.test;
  for (const changedCommand of [
    command.replace(`${permissionsBuild} && `, ''),
    command.replace(`${authBuild} && `, ''),
    command.replace(`${permissionsBuild} && ${authBuild}`, `${authBuild} && ${permissionsBuild}`),
    command.replace(`${authBuild} && ${wiringContractCommand}`, `${wiringContractCommand} && ${authBuild}`),
    command.replace(`${wiringContractCommand} && `, ''),
    command.replace(`${wiringContractCommand} && ${contractCommand}`, `${contractCommand} && ${wiringContractCommand}`),
  ]) {
    assert.notEqual(changedCommand, command);
    const changed = structuredClone(e2e);
    changed.scripts.test = changedCommand;
    assert.throws(() => assertWiring(root, changed), assert.AssertionError);
  }
});

test('packaged legacy recovery requires preparation and a fresh hardened package', () => {
  for (const removed of ['pnpm e2e:prepare && ', 'pnpm --filter @eky/desktop installer:supervisor:build && ',
    'pnpm --filter @eky/desktop package:windows:pilot && ']) {
    const changed = structuredClone(e2e);
    changed.scripts['e2e:packaged:legacy'] = changed.scripts['e2e:packaged:legacy'].replace(removed, '');
    assert.throws(() => assertWiring(root, changed), assert.AssertionError);
  }
  assert.doesNotMatch(e2e.scripts['e2e:all'], /packaged/u);
});

test('packaged local setup runs ordinary smoke once and teardown checks its original pin', async () => {
  const environment = {}, calls = [], pin = 'a'.repeat(64);
  const teardown = await setupPackagedPilotSeries({ environment,
    async inspect(expected) { calls.push(['inspect', expected]); return { pin }; },
    async smoke(value) { calls.push(['smoke', value.seriesManifestSha256]); } });
  assert.equal(environment[packagedSeriesManifestVariable], pin);
  environment[packagedSeriesManifestVariable] = 'b'.repeat(64);
  await teardown();
  assert.deepEqual(calls, [['inspect', undefined], ['smoke', pin], ['inspect', pin]]);
  assert.equal(Object.hasOwn(environment, packagedSeriesManifestVariable), false);
});

test('packaged CI setup requires the prior smoke pin and never recaptures or repeats smoke', async () => {
  let reads = 0, smokes = 0;
  const pin = 'a'.repeat(64), environment = { CI: 'true', [packagedSeriesManifestVariable]: pin };
  const inspect = async expected => { reads++; assert.equal(expected, pin); return { pin }; };
  const smoke = async () => { smokes++; };
  await assert.rejects(setupPackagedPilotSeries({ environment: { CI: 'true' }, inspect, smoke }));
  await assert.rejects(setupPackagedPilotSeries({ environment: { [packagedSeriesManifestVariable]: pin }, inspect, smoke }));
  assert.equal(reads, 0); assert.equal(smokes, 0);
  const teardown = await setupPackagedPilotSeries({ environment, inspect, smoke });
  await teardown(); assert.equal(reads, 2); assert.equal(smokes, 0);
  assert.equal(environment[packagedSeriesManifestVariable], pin);
});

test('packaged teardown rejects changed bytes without replacing its original pin', async () => {
  let reads = 0; const first = new Error('SYNTHETIC_SERIES_CHANGED');
  const teardown = await setupPackagedPilotSeries({ environment: {},
    async inspect() { if (++reads > 1) throw first; return { pin: 'a'.repeat(64) }; }, smoke: async () => {} });
  await assert.rejects(teardown(), error => error === first);
});

test('packaged setup controls import and execute without any desktop dist access', () => {
  const setup = new URL('./packagedPilotSeriesSetup.mjs', import.meta.url).href;
  const dist = new URL('../../desktop/dist/', import.meta.url).href;
  const source = [
    'import { registerHooks } from "node:module";',
    `const dist = ${JSON.stringify(dist)};`,
    'registerHooks({ resolve(specifier, context, nextResolve) {',
    '  const result = nextResolve(specifier, context);',
    '  if (result.url.startsWith(dist)) throw new Error("PACKAGED_CONTROL_UNEXPECTED_DIST");',
    '  return result;',
    '} });',
    `const { setupPackagedPilotSeries } = await import(${JSON.stringify(setup)});`,
    'const teardown = await setupPackagedPilotSeries({ environment: {},',
    '  inspect: async () => ({ pin: "a".repeat(64) }), smoke: async () => {} });',
    'await teardown();',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 5_000 });
  assert.ifError(result.error); assert.equal(result.status, 0, result.stderr);
});

const consumerContracts = ['linuxConsumerLossContract', 'linuxConsumerLossRecords', 'linuxConsumerLossOutcome',
  'linuxConsumerSessionProbe', 'linuxConsumerLossInit', 'linuxConsumerExchange', 'linuxConsumerCommandGate',
  'linuxConsumerAttachments', 'linuxConsumerObserver', 'linuxConsumerSentinel', 'linuxConsumerLossBuild',
  'linuxConsumerLossBuildCli', 'runLinuxConsumerLossCase', 'runLinuxConsumerLoss'];
const consumerContractCommand = 'node --test --test-reporter=../../test-reporters/nodeFailureReporter.mjs ' + consumerContracts
  .map(name => `experiments/processOwnership/${name}.test.mjs`).join(' ');

test('original Electron failure proof cannot omit preparation or join normal application selection', () => {
  const changed = structuredClone(e2e);
  changed.scripts['e2e:electron:evidence'] = changed.scripts['e2e:electron:evidence'].replace('pnpm e2e:electron:prepare && ', '');
  assert.throws(() => assertWiring(root, changed), assert.AssertionError);
  assert.ok(readFileSync(new URL('../../../test-reporters/tests/electronDevelopmentFailureEvidenceOpenPgp.test.mjs', import.meta.url)).length > 0);
  for (const name of ['e2e:all', 'e2e:electron', 'e2e:electron:critical', 'e2e:desktop-stress', 'e2e:desktop-soak']) {
    assert.doesNotMatch(e2e.scripts[name], /electron:evidence|electronDevelopmentFailureEvidenceOpenPgp/u);
  }
});

for (const name of consumerContracts) {
  test(`the recursive contract gate cannot omit ${name}`, () => {
    const modified = structuredClone(e2e);
    modified.scripts['test:consumer-loss'] = modified.scripts['test:consumer-loss']
      .replace(` experiments/processOwnership/${name}.test.mjs`, '');
    assert.throws(() => assertWiring(root, modified), assert.AssertionError);
  });
}

test('manual consumer faults cannot join ordinary or endurance project commands', () => {
  for (const name of ['e2e:all', 'e2e:system', 'e2e:web', 'e2e:web:critical', 'e2e:stress']) {
    assert.doesNotMatch(e2e.scripts[name], /linux:consumer|runLinuxConsumerLoss/u);
  }
  assert.equal(e2e.scripts['e2e:stress'], 'pnpm e2e:prepare && playwright test --project=endurance-baseline');
});

test('the recursive workspace chain reaches this contract and both complete aggregates', () => {
  assertWiring(root, e2e);
  assert.ok(readFileSync(new URL('../scripts/e2e-command-wiring.test.mjs', import.meta.url)).length > 0);
});

test('preparation delegates to existing build and staging owners', () => {
  const manifests = new Map([
    ['@eky/desktop', desktop], ['@eky/backend', backend], ['@eky/e2e', e2e],
    ['@eky/auth', readManifest('../../../packages/auth/package.json')],
    ['@eky/permissions', readManifest('../../../packages/permissions/package.json')],
    ['@eky/web', readManifest('../../web/package.json')],
  ]);
  // Only these literal named pnpm calls are a supported contract, not arbitrary shell syntax.
  for (const command of preparations) {
    const [pnpm, filter, name, script, ...extra] = command.split(' ');
    assert.deepEqual([pnpm, filter, extra.length], ['pnpm', '--filter', 0]);
    assert.ok(manifests.get(name)?.scripts[script], command);
  }
  assert.equal(desktop.scripts['e2e:prepare-backend'], 'node scripts/prepare-electron-e2e-backend.mjs');
  assert.equal(
    desktop.scripts['e2e:prepare-electron-runtime'],
    'pnpm exec install-electron --no && node scripts/assert-electron-development-runtime.mjs',
  );
  assert.equal(backend.scripts['e2e:build'],
    'node scripts/clean-e2e-dist.mjs && tsc -p tsconfig.e2e.json && node scripts/copy-e2e-migrations.mjs');
});

test('initial and restarted Electron API contexts use the already verified real backend port', () => {
  const source = readFileSync(new URL('../src/fixtures/isolatedElectronTest.ts', import.meta.url), 'utf8');
  const bound = 'await createElectronApi(selectorBackendPort ?? backendPort, runtime.sessionSecret)';
  assert.equal(source.split(bound).length - 1, 2);
  assert.equal(source.includes('await createElectronApi(backendPort, runtime.sessionSecret)'), false);
  for (const changed of [source.replace(bound, 'await createElectronApi(backendPort, runtime.sessionSecret)'),
    source.replaceAll(bound, 'await createElectronApi(backendPort, runtime.sessionSecret)')]) {
    assert.notEqual(changed.split(bound).length - 1, 2);
  }
});

function workflowJob(source, id) {
  const blocks = source.split('\njobs:\n')[1]?.split(/(?=^  [\w-]+:\s*$)/mu) ?? [];
  const matches = blocks.filter(block => block.startsWith(`  ${id}:\n`));
  assert.equal(matches.length, 1, `one exact job required: ${id}`);
  return matches[0];
}

function workflowStep(job, name) {
  const blocks = job.split(/(?=^      - name: )/mu).slice(1);
  const matches = blocks.filter(block => block.startsWith(`      - name: ${name}\n`));
  assert.equal(matches.length, 1, `one exact step required: ${name}`);
  return matches[0].trimEnd();
}

function assertWindowsOwnerCiPreparation(source) {
  const job = workflowJob(source, 'e2e-electron-windows-critical');
  assert.ok(job, 'the actual Windows consumer must remain reachable');
  const name = '      - name: Set up existing Windows test owner SDK\n';
  const steps = job.split(name);
  assert.equal(steps.length, 2, 'the owner SDK must be prepared exactly once');
  const sdk = steps[1].split('\n      - name:')[0].trimEnd();
  assert.equal(sdk, [
    '        uses: actions/setup-dotnet@26b0ec14cb23fa6904739307f278c14f94c95bf1',
    '        with:',
    '          dotnet-version: 10.0.302',
  ].join('\n'));
  const consumer = job.indexOf('        run: pnpm test:e2e:electron:critical\n');
  assert.ok(consumer > job.indexOf(name), 'the SDK must precede the normal consumer');
  assert.match(job, /    runs-on: windows-latest\n/u);
  assert.equal(root.scripts['test:e2e:electron:critical'], 'pnpm --filter @eky/e2e e2e:electron:critical');
  assert.equal(e2e.scripts['e2e:electron:critical'],
    'pnpm e2e:electron:prepare && playwright test --project=electron-development --grep @critical --workers=1');
}

const ci = readFileSync(new URL('../../../../.github/workflows/ci.yml', import.meta.url), 'utf8');
const packagedSteps = [
  ['Package Windows desktop', 'pnpm --filter @eky/desktop package:windows:pilot'],
  ['Run packaged Windows smoke', 'pnpm --filter @eky/desktop smoke:windows --pilot-series-start'],
  ['Prepare packaged legacy recovery runtime', 'pnpm --filter @eky/e2e e2e:prepare'],
  ['Build existing packaged process owner', 'pnpm --filter @eky/desktop installer:supervisor:build'],
  ['Run packaged legacy recovery', 'pnpm --filter @eky/e2e exec playwright test --config playwright.packaged-legacy.config.ts'],
];
const preparationSteps = [
  'Check out repository', 'Set up Node.js', 'Prepare locked package manager',
  'Set up existing Windows test owner SDK', 'Install dependencies', 'Prepare Electron development runtime',
];
function assertPackagedLegacyCi(source) {
  const development = workflowJob(source, 'e2e-electron-windows-critical');
  const job = workflowJob(source, 'e2e-packaged-windows-smoke');
  assertWindowsOwnerCiPreparation(source);
  for (const block of [development, job]) {
    assert.match(block, /^    runs-on: windows-latest$/mu);
    assert.match(block, /^    timeout-minutes: 35$/mu);
    assert.match(block, /defaults:\n      run:\n        working-directory: eky_software\n/u);
    assert.doesNotMatch(block.split('\n    steps:\n')[0], /needs:|continue-on-error:|strategy:/u);
  }
  for (const name of preparationSteps) {
    assert.equal(workflowStep(job, name), workflowStep(development, name), name);
  }
  assert.deepEqual([...job.matchAll(/^      - name: (.+)$/gmu)].map(match => match[1]),
    [...preparationSteps, ...packagedSteps.map(([name]) => name), 'Preserve encrypted CI failure evidence']);
  for (const [name, command] of packagedSteps) {
    assert.equal(workflowStep(job, name), `      - name: ${name}\n        run: ${command}`);
    assert.ok(!development.includes(`      - name: ${name}\n`));
  }
  assert.equal(workflowStep(development, 'Run critical Electron E2E journeys'),
    '      - name: Run critical Electron E2E journeys\n        run: pnpm test:e2e:electron:critical');
  assert.doesNotMatch(job, /test:e2e:electron:critical|e2e:packaged:legacy|upload-artifact|download-artifact|EKY_PACKAGED_SERIES_MANIFEST_SHA256:/u);
}
test('packaged deletion shares the existing aggregate budget and cannot omit its owned workflow', () => {
  const source = readFileSync(new URL('../playwright.packaged-legacy.config.ts', import.meta.url), 'utf8');
  assert.match(source, /workspaceDeletionRecovery/u);
  assert.match(source, /timeout: packagedSmokeWorkflowTimeoutMilliseconds/u);
  assert.match(source, /retries: 0/u);
  assert.match(source, /globalSetup: '\.\/scripts\/packagedPilotSeriesSetup\.mjs'/u);
  const limits = readFileSync(new URL('../../desktop/scripts/packagedSmokeLimits.mjs', import.meta.url), 'utf8');
  assert.match(limits, /packagedSmokeWorkflowTimeoutMilliseconds = 300_000/u);
  const testSource = readFileSync(new URL('../tests/packaged/workspaceDeletionRecovery.spec.ts', import.meta.url), 'utf8');
  assert.match(testSource, /runOwnedPackagedSmokeWorkflow/u);
  assert.match(testSource, /createE2eFixtureLifetime/u);
  assert.doesNotMatch(testSource, /runPackagedSmoke\(/u);
});

test('normal Windows CI binds legacy recovery to fresh packaging and required preparation', () => {
  assertPackagedLegacyCi(ci);
  for (const mutate of [
    source => source.replace('Build existing packaged process owner\n', 'Build existing packaged process owner\n        continue-on-error: true\n'),
    source => source.replace('        run: pnpm --filter @eky/e2e e2e:prepare\n', '        run: echo omitted\n'),
    source => source.replace('Run packaged legacy recovery\n', 'Run packaged legacy recovery\n        continue-on-error: true\n'),
    source => source.replace('Run packaged legacy recovery\n', 'Run packaged legacy recovery\n        if: inputs.electron_diagnostic\n'),
    source => source.replace('Run packaged legacy recovery\n', 'Skipped legacy recovery\n'),
  ]) assert.throws(() => assertPackagedLegacyCi(mutate(ci)), assert.AssertionError);
});

test('split packaged wiring rejects omitted, conditional, reordered and ignored steps at exact job boundaries', () => {
  const id = 'e2e-packaged-windows-smoke';
  const job = workflowJob(ci, id);
  const development = workflowJob(ci, 'e2e-electron-windows-critical');
  for (const name of [...preparationSteps, ...packagedSteps.map(([name]) => name)]) {
    const step = workflowStep(job, name);
    for (const changed of [
      '',
      step.replace(`name: ${name}\n`, `name: ${name}\n        if: success()\n`),
      step.replace(`name: ${name}\n`, `name: ${name}\n        continue-on-error: true\n`),
      `${step}\n        continue-on-error: true`,
      `${step}\n${step}`,
    ]) assert.throws(() => assertPackagedLegacyCi(ci.replace(job, job.replace(step, changed))), assert.AssertionError);
    // Keeping the missing step in the next job must not satisfy this job.
    const missing = ci.replace(job, job.replace(step, ''));
    assert.throws(() => assertPackagedLegacyCi(missing.replace('\n  windows-contracts:\n',
      `\n  following-decoy:\n    steps:\n${step}\n\n  windows-contracts:\n`)), assert.AssertionError);
  }
  for (let index = 0; index < packagedSteps.length - 1; index++) {
    const first = workflowStep(job, packagedSteps[index][0]);
    const second = workflowStep(job, packagedSteps[index + 1][0]);
    const swapped = job.replace(first, 'SWAPPED_STEP').replace(second, first).replace('SWAPPED_STEP', second);
    assert.throws(() => assertPackagedLegacyCi(ci.replace(job, swapped)), assert.AssertionError);
  }
  const consumer = workflowStep(development, 'Run critical Electron E2E journeys');
  const moved = ci.replace(development, development.replace(consumer, '')).replace(job,
    job.replace('    steps:\n', `    steps:\n${consumer}\n`));
  assert.throws(() => assertPackagedLegacyCi(moved), assert.AssertionError);
  assert.throws(() => workflowJob(`${ci}\n${job}`, id), assert.AssertionError);
});
test('the normal Windows consumer prepares the existing SDK before its actual owner build', () => {
  assertWindowsOwnerCiPreparation(ci);
});

for (const [name, mutate] of [
  ['missing SDK', source => source.replace('Set up existing Windows test owner SDK', 'Missing SDK')],
  ['conditional SDK', source => source.replace('Set up existing Windows test owner SDK\n',
    'Set up existing Windows test owner SDK\n        if: inputs.electron_diagnostic\n')],
  ['ignored SDK failure', source => source.replace('Set up existing Windows test owner SDK\n',
    'Set up existing Windows test owner SDK\n        continue-on-error: true\n')],
  ['different SDK', source => source.replace('dotnet-version: 10.0.302', 'dotnet-version: 9.0.0')],
  ['missing actual consumer', source => source.replace('run: pnpm test:e2e:electron:critical', 'run: echo skipped')],
]) {
  test(`rejects Windows preparation drift: ${name}`, () => {
    assert.throws(() => assertWindowsOwnerCiPreparation(mutate(ci)), assert.AssertionError);
  });
}

const mutations = [
  ['missing original failure reporter', (r, e) => { e.scripts.test = e.scripts.test.replace(' --test-reporter=../../test-reporters/nodeFailureReporter.mjs', ''); }],
  ['missing consumer failure reporter', (r, e) => { e.scripts['test:consumer-loss'] = e.scripts['test:consumer-loss'].replace(' --test-reporter=../../test-reporters/nodeFailureReporter.mjs', ''); }],
  ['missing Linux service contract', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/linuxServiceContract.test.mjs', ''); }],
  ['missing Linux service control', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/linuxServiceControl.test.mjs', ''); }],
  ['missing Linux service lifecycle', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/linuxServiceSession.test.mjs', ''); }],
  ['missing process-only kill regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/playwrightElectronProcessKill.test.mjs', ''); }],
  ['missing reporter regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/safeCiReporter.test.mjs', ''); }],
  ['missing direct composition preflight relay regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/compositionPreflightRelay.test.mjs', ''); }],
  ['missing lifecycle projection regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/electronLifecycleProjection.test.mjs', ''); }],
  ['missing artifact retention regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/e2eRunArtifacts.test.mjs', ''); }],
  ['missing deletion failure evidence regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/workspaceDeletionFailureEvidence.test.mjs', ''); }],
  ['missing adoption failure evidence regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/workspaceAdoptionProofEvidence.test.mjs', ''); }],
  ['missing owner build regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' scripts/windowsBackendOwnerBuild.test.mjs', ''); }],
  ['missing native owner preparation', (r, e) => { e.scripts['e2e:prepare'] = preparations.slice(2, 5).join(' && '); }],
  ['wrong native owner build', (r, e) => { e.scripts['e2e:prepare-owner'] = 'node unrelated.mjs'; }],
  ['missing Chromium diagnostic regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedChromiumFailure.test.mjs', ''); }],
  ['missing Chromium worker regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedChromiumActor.test.mjs', ''); }],
  ['missing preparation', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].split(' && ')[1]; }],
  ['backend-only preparation', (r, e) => { e.scripts['e2e:fault'] = e.scripts['e2e:fault'].replace('e2e:electron:prepare', 'e2e:prepare'); }],
  ['unconditional launch', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].replace(' && ', ' ; '); }],
  ['unknown project', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].replace('system-api', 'unknown-project'); }],
  ['missing project', (r, e) => { e.scripts['e2e:fault'] = e.scripts['e2e:fault'].replace(' --project=electron-development', ''); }],
  ['endurance included', (r, e) => { e.scripts['e2e:fault'] += ' --project=electron-endurance'; }],
  ['wrong tag', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].replace('@security', '@critical'); }],
  ['extra positional filter', (r, e) => { e.scripts['e2e:fault'] += ' selected.spec.ts'; }],
  ['inverted tag', (r, e) => { e.scripts['e2e:fault'] += ' --grep-invert @slow'; }],
  ['launch before preparation', (r, e) => { e.scripts['e2e:security'] = e.scripts['e2e:security'].split(' && ').reverse().join(' && '); }],
  ['omitted stage', (r, e) => { e.scripts['e2e:electron:prepare'] = preparations.slice(0, -1).join(' && '); }],
  ['changed prerequisite order', (r, e) => { e.scripts['e2e:electron:prepare'] = preparations.toReversed().join(' && '); }],
  ['unconditional prerequisite', (r, e) => { e.scripts['e2e:electron:prepare'] = preparations.join(' ; '); }],
  ['missing recursive hook', (r) => { r.scripts.test = 'pnpm --filter @eky/backend test'; }],
  ['missing self hook', (r, e) => { delete e.scripts.test; }],
  ['missing dependency regression', (r, e) => { e.scripts.test = 'node --test scripts/e2e-command-wiring.test.mjs'; }],
  ['missing adapter control regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/adapterControl.test.mjs', ''); }],
  ['missing adapter ordering regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/adapterRootExitOrdering.test.mjs', ''); }],
  ['missing bounded output regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/boundedChildOutput.test.mjs', ''); }],
  ['missing namespace regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/pidNamespaceContract.test.mjs', ''); }],
  ['missing managed namespace regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceContract.test.mjs', ''); }],
  ['missing managed control regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceControl.test.mjs', ''); }],
  ['missing managed observation regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceObservation.test.mjs', ''); }],
  ['missing managed preflight regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespacePreflight.test.mjs', ''); }],
  ['missing managed command regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceCommand.test.mjs', ''); }],
  ['missing managed session regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceSession.test.mjs', ''); }],
  ['missing managed result regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/managedNamespaceResult.test.mjs', ''); }],
  ['missing managed experiment regression', (r, e) => { e.scripts.test = e.scripts.test.replace(' experiments/processOwnership/runManagedNamespaceExperiment.test.mjs', ''); }],
  ['missing wiring regression', (r, e) => { e.scripts.test = 'node --test experiments/processOwnership/playwrightElectronLaunch.test.mjs'; }],
  ['wrong self hook', (r, e) => { e.scripts.test = 'node --test scripts/other.test.mjs'; }],
  ['wrong root alias', (r) => { r.scripts['test:e2e:security'] = 'pnpm --filter @eky/e2e e2e:critical'; }],
];
for (const [name, mutate] of mutations) {
  test(`rejects command drift: ${name}`, () => {
    const rootCopy = structuredClone(root);
    const e2eCopy = structuredClone(e2e);
    mutate(rootCopy, e2eCopy);
    assert.throws(() => assertWiring(rootCopy, e2eCopy), assert.AssertionError);
  });
}

test('a failed named prerequisite prevents every later phase and launch in a bounded shell fixture', () => {
  assertWiring(root, e2e);
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'eky-command-contract-'));
  const directory = join(fixtureRoot, "literal $SHELL $(exit 42) `exit 42` 'quoted'");
  try {
    mkdirSync(directory);
    const step = join(directory, 'step.mjs');
    const ledger = join(directory, 'steps.jsonl');
    writeFileSync(step, [
      "import { appendFileSync } from 'node:fs';",
      'const [index, failure, ledger] = process.argv.slice(2);',
      "appendFileSync(ledger, JSON.stringify(Number(index)) + '\\n');",
      'process.exit(index === failure ? 17 : 0);',
    ].join('\n'));
    // Substitute only known calls with inert processes; preserve the actual && chain.
    const commands = e2e.scripts['e2e:electron:prepare'].split(' && ');
    for (const failedStep of [...commands.keys(), -1]) {
      rmSync(ledger, { force: true });
      const windows = process.platform === 'win32';
      const quote = (value) => {
        if (!windows) return `'${value.replaceAll("'", "'\\''")}'`;
        assert.ok(!/["\r\n%]/u.test(value), 'fixture paths must be safe literal shell arguments');
        return `"${value}"`;
      };
      const inert = (index) => [quote(process.execPath), quote(step), index, failedStep, quote(ledger)].join(' ');
      const chain = [...commands.map((_, index) => inert(index)), inert(commands.length)].join(' && ');
      const result = spawnSync(windows ? process.env.ComSpec ?? 'cmd.exe' : '/bin/sh',
        windows ? ['/d', '/v:off', '/s', '/c', `"${chain}"`] : ['-c', chain],
        { encoding: 'utf8', windowsVerbatimArguments: windows });
      assert.ifError(result.error);
      assert.equal(result.status, failedStep === -1 ? 0 : 17, result.stderr);
      const observed = readFileSync(ledger, 'utf8').trim().split('\n').map(JSON.parse);
      const expectedLength = failedStep === -1 ? commands.length + 1 : failedStep + 1;
      assert.deepEqual(observed, Array.from({ length: expectedLength }, (_, index) => index));
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
