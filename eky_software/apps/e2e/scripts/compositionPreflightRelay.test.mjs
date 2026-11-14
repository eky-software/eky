import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateRunnerFailureEvidence } from '../../../test-reporters/runnerFailureEvidence.mjs';
import { REPORT_PREFIX } from './safeCiReporter.mjs';

const require = createRequire(import.meta.url);
const cli = require.resolve('@playwright/test/cli');
const playwright = new URL('./index.mjs', pathToFileURL(require.resolve('@playwright/test'))).href;
const source = path => new URL(path, import.meta.url).href;
const marker = 'MANAGED_NAMESPACE_PREFLIGHT_CHECK:sudo:ancestor:symbolicLink';
const cases = [
  { name: 'backend direct caller', spec: 'e2eBackendComposition', grep: 'boots the real backend', stage: 'backend' },
  { name: 'web direct caller backend failure', spec: 'e2eWebComposition', grep: 'WEB-SERVICE-001', stage: 'backend' },
  { name: 'negative direct caller unexpected backend failure', spec: 'e2eWebComposition', grep: 'WEB-SERVICE-002', stage: 'backend' },
  { name: 'web direct caller Vite failure', spec: 'e2eWebComposition', grep: 'WEB-SERVICE-001', stage: 'vite' },
  { name: 'negative direct caller unexpected Vite rejection retains assertion', spec: 'e2eWebComposition', grep: 'WEB-SERVICE-002', stage: 'vite', assertionFailure: true },
  { name: 'negative direct caller expected rejection stays unrecorded', spec: 'e2eWebComposition', grep: 'WEB-SERVICE-002', stage: 'expected' },
  { name: 'expected failed direct caller stays unrecorded', spec: 'e2eBackendComposition', grep: 'boots the real backend', stage: 'backend', expectedFailure: true },
  { name: 'missing private check stays missing', spec: 'e2eBackendComposition', grep: 'boots the real backend', stage: 'backend', missing: true },
  { name: 'private reader failure preserves original throw', spec: 'e2eBackendComposition', grep: 'boots the real backend', stage: 'backend', readerFailure: true },
  { name: 'private sink failure preserves original throw', spec: 'e2eBackendComposition', grep: 'boots the real backend', stage: 'backend', sinkFailure: true },
  { name: 'unverified cleanup retains root before relay', spec: 'e2eBackendComposition', grep: 'boots the real backend', stage: 'backend', cleanupFailure: true },
];

// Like safeCiReporter.test.mjs, run a reporting-only Playwright consumer in a
// fresh temp root. Import the actual spec; never copy or rewrite its test body.
function runnerFixture(t, selected) {
  const root = mkdtempSync(join(tmpdir(), 'eky-composition-preflight-relay-'));
  let accepted = false;
  t.after(() => { if (accepted && !selected.cleanupFailure) rmSync(root, { recursive: true, force: true }); });
  const put = (name, bytes) => writeFileSync(join(root, name), bytes);
  const spec = source(`../tests/system/${selected.spec}.spec.ts`);
  const pins = {};
  for (const path of [`../tests/system/${selected.spec}.spec.ts`,
    '../src/environment/startE2eBackendProcess.ts', '../src/environment/startE2eWebProcess.ts',
    '../src/fixtures/finishServiceFixture.ts', '../src/fixtures/reportStartupProcessOutput.ts',
    '../experiments/processOwnership/managedNamespacePreflight.mjs',
    '../experiments/processOwnership/linuxServiceSession.mjs', './compositionPreflightRelay.test.mjs']) {
    const bytes = readFileSync(new URL(path, import.meta.url));
    const name = path.split('/').at(-1);
    put(`source-${name}`, bytes);
    pins[path] = createHash('sha256').update(bytes).digest('hex');
  }
  put('source-pins.private.json', JSON.stringify(pins));
  put('package.json', JSON.stringify({ type: 'module' }));
  mkdirSync(join(root, 'tests'));
  put('tests/caller.spec.ts', `import '../hooks.mjs';\nawait import(${JSON.stringify(spec)});\n`);
  put('playwright.config.mjs', [
    `export default { testDir: './tests', workers: 1, retries: 0, timeout: 10000, globalTimeout: 30000,`,
    `outputDir: './results', projects: [{ name: 'system-api' }], reporter: [`,
    `[${JSON.stringify(fileURLToPath(new URL('./safeCiReporter.mjs', import.meta.url)))}],`,
    `['json', { outputFile: './results.private.json' }]] };`,
  ].join('\n'));
  put('hooks.mjs', `
import { registerHooks } from 'node:module';
const spec = ${JSON.stringify(spec)};
const ports = new Set(['startE2eBackendProcess.js', 'startE2eWebProcess.js', 'finishServiceFixture.js']);
registerHooks({ resolve(name, context, next) {
  if (context.parentURL?.toLowerCase() === spec.toLowerCase()) {
    if (name === '@playwright/test') return { url: new URL('./registration.mjs', import.meta.url).href, shortCircuit: true };
    if (ports.has(name.split('/').at(-1))) return { url: new URL('./ports.mjs', import.meta.url).href, shortCircuit: true };
    // These backend-only imports are not used by the selected startup body.
    if (name.includes('/backend/')) return { url: new URL('./unused.mjs', import.meta.url).href, shortCircuit: true };
  }
  if (name.startsWith('@eky/')) throw new Error('COMPOSITION_PROOF_BUSINESS_IMPORT_FORBIDDEN');
  return next(name, context);
} });
`);
  put('unused.mjs', `
const unused = () => { throw new Error('COMPOSITION_PROOF_UNUSED_PORT_CALLED'); };
export { unused as readE2eBackendConfig, unused as E2eFakeSmtpProvider,
  unused as createE2eInvoiceDocumentStorage, unused as InvoiceDocumentIntegrityError,
  unused as InvoiceSmtpDeliveryError };
`);
  put('ports.mjs', `
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { startE2eBackendProcess as realBackend, E2eBackendStartupFailure } from ${JSON.stringify(source('../src/environment/startE2eBackendProcess.ts'))};
import { startE2eWebProcess as realWeb, E2eWebStartupFailure } from ${JSON.stringify(source('../src/environment/startE2eWebProcess.ts'))};
import { finishServiceFixture as finish } from ${JSON.stringify(source('../src/fixtures/finishServiceFixture.ts'))};
import { startOwnedLinuxBackend } from ${JSON.stringify(source('../src/environment/startOwnedLinuxBackend.ts'))};
import { startOwnedLinuxVite } from ${JSON.stringify(source('../src/environment/startOwnedLinuxVite.ts'))};
import { OwnedLinuxServiceStartupFailure } from ${JSON.stringify(source('../experiments/processOwnership/linuxServiceSession.mjs'))};
import { inspectManagedHost } from ${JSON.stringify(source('../experiments/processOwnership/managedNamespacePreflight.mjs'))};
export { E2eBackendStartupFailure, E2eWebStartupFailure };
export const selected = ${JSON.stringify(selected)};
export const state = { events: [], reads: 0, metadataReads: 0, caught: undefined, runRoot: undefined };
const forbidden = () => { throw new Error('COMPOSITION_PROOF_SUBPROCESS_FORBIDDEN'); };
const remember = async operation => {
  try { return await operation(); } catch (error) {
    state.caught = error;
    const read = error.readPrivatePreflightCheck.bind(error);
    state.hasCheck = read() === ${JSON.stringify(marker)};
    state.publicError = { message: error.message, stack: error.stack, cause: error.cause, evidence: error.evidence,
      serialized: JSON.stringify(error), stdout: error.readPrivateOutput()?.stdout, stderr: error.readPrivateOutput()?.stderr };
    error.readPrivatePreflightCheck = () => {
      state.reads++;
      assert.equal(state.events.at(-1), 'report');
      assert.equal(existsSync(state.runRoot), selected.cleanupFailure === true);
      if (selected.readerFailure) throw new Error('SYNTHETIC_PRIVATE_READER_FAILED');
      return read();
    };
    throw error;
  }
};
const ownerDependencies = {
  prepare() {
    state.events.push('prepare');
    return { config: { generation: 'a'.repeat(32), startUntil: '45001000000', workUntil: '90001000000' } };
  },
  now: () => 1000000n,
  async preflight(input) {
    assert.equal(input.privateDiagnostics, true);
    return inspectManagedHost({ ...input, privateDiagnostics: !selected.missing,
      runtime: { platform: 'linux', env: { EKY_E2E: '1', CI: 'true', GITHUB_ACTIONS: 'true' },
        getuid: () => 1001, geteuid: () => 1001, getgid: () => 1002, getegid: () => 1002 },
      fs: { async lstat() { state.metadataReads++; return { isSymbolicLink: () => true }; } },
    });
  },
  createManager: forbidden, listen: forbidden,
  removeControl() { state.events.push('ownerCleanup'); },
};
export async function startE2eBackendProcess(input) {
  state.runRoot = input.runRoot;
  return remember(() => realBackend(input, { startOwned: selected.stage === 'backend'
    ? ownerInput => startOwnedLinuxBackend(ownerInput, ownerDependencies)
    : async () => {
      // A synthetic owner supplies health only. The actual safe backend wrapper
      // still owns config, health admission, stop and port-release behavior.
      const server = createServer((request, response) => {
        assert.equal(request.url, '/health'); response.writeHead(200); response.end('{}');
      });
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(input.backendPort, '127.0.0.1', resolve); });
      let stopped = false;
      return { readStdout: () => '', readStderr: () => '',
        startup: { readState: () => ({ spawnObserved: true, terminal: undefined }), subscribe: () => () => {} },
        workload: { readState: async () => stopped ? 'exited' : 'running' },
        async stop() { state.events.push('backendStop');
          await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); stopped = true; },
      };
    } }));
}
export async function startE2eWebProcess(input) {
  return remember(() => realWeb(input, { startOwned: async ownerInput => {
    try { return await startOwnedLinuxVite(ownerInput, ownerDependencies); }
    catch (error) {
      if (selected.stage !== 'expected') throw error;
      // The occupied-port test expects a child exit. Preserve the real generated
      // preflight cause to prove its private check is NOT reported on success.
      throw new OwnedLinuxServiceStartupFailure('vite', { spawnObserved: true, exitedBeforeCleanup: true,
        processTree: 'stopped', startupFailure: 'workloadExited' },
        { readStdout: () => '', readStderr: () => 'already in use' }, { cause: error.cause });
    }
  } }));
}
export async function finishServiceFixture(input) {
  const steps = {};
  for (const name of ['disposeApi', 'stopWeb', 'stopBackend', 'releaseWebPort', 'releaseBackendPort', 'collectArtifacts', 'removeRoot']) {
    if (input[name]) steps[name] = async () => { state.events.push(name); await input[name]();
      if (name === 'releaseBackendPort' && selected.cleanupFailure) throw new Error('SYNTHETIC_PORT_PROOF_FAILED'); };
  }
  const failure = input.failure?.error;
  try { await finish({ ...input, ...steps, report: async cleanup => {
    state.cleanup = cleanup; state.events.push('report');
    if (selected.sinkFailure) {
      // Make the existing sink's new-directory creation fail, not a fake sink.
      process.env.TEMP = process.env.TMP = process.env.TMPDIR = fileURLToPath(new URL('./unavailable', import.meta.url));
    }
    await input.report(cleanup);
  } }); } catch (error) {
    assert.equal(error, failure, 'cleanup/reporting must rethrow the identical original');
    state.identicalFailure = true;
    state.identicalThrow = error === state.caught;
    throw error;
  }
}
`);
  put('registration.mjs', `
import { existsSync, writeFileSync } from 'node:fs';
import { test as actualTest, expect } from ${JSON.stringify(playwright)};
import { selected, state } from './ports.mjs';
export { expect };
export const test = Object.assign((title, body) => actualTest(title, async ({}, info) => {
  if (selected.expectedFailure) actualTest.fail();
  try { await body({}, info); } finally {
    const publicAttachments = info.attachments.map(value => ({ name: value.name, body: value.body?.toString() }));
    writeFileSync(new URL('./caller-receipt.private.json', import.meta.url), JSON.stringify({
      ...state, caught: undefined, publicAttachments, test: { name: info.title, id: info.testId, file: info.file,
        attempt: info.retry, retryCount: info.retry, repeatCount: info.repeatEachIndex },
      rootExists: existsSync(state.runRoot),
    }));
  }
}), { describe: actualTest.describe });
`);
  const env = {};
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'ComSpec']) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  Object.assign(env, { TEMP: root, TMP: root, TMPDIR: root, CI: 'true', FORCE_COLOR: '0',
    GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '75401113', GITHUB_RUN_ATTEMPT: '1',
    GITHUB_JOB: 'composition-relay-synthetic', GITHUB_SHA: 'a'.repeat(40) });
  const result = spawnSync(process.execPath, [cli, 'test', '--config', join(root, 'playwright.config.mjs'), '--grep', selected.grep],
    { cwd: root, env, encoding: 'utf8', timeout: 45000, maxBuffer: 1024 * 1024, windowsHide: true });
  put('runner-output.private.txt', (result.stdout ?? '') + (result.stderr ?? ''));
  assert.equal(result.error, undefined, 'bounded composition runner must terminate');
  assert.equal(result.signal, null);
  assert.equal((result.stdout + result.stderr).includes(marker), false, 'private marker excluded from public console');
  const events = result.stdout.split(/\r?\n/u).filter(line => line.startsWith(REPORT_PREFIX))
    .map(line => JSON.parse(line.slice(REPORT_PREFIX.length)));
  assert.equal(events.find(event => event.event === 'begin')?.selected, 1, 'one actual caller must execute');
  assert.equal(events.filter(event => event.event === 'testEnd').length, 1, 'no hidden retry or duplicate caller');
  const report = JSON.parse(readFileSync(join(root, 'results.private.json'), 'utf8'));
  assert.equal(report.errors.length, 0, 'actual spec must collect without business/runtime imports');
  const receipt = JSON.parse(readFileSync(join(root, 'caller-receipt.private.json'), 'utf8'));
  const records = readdirSync(root).filter(name => name.startsWith('eky-test-errors-'))
    .flatMap(name => readdirSync(join(root, name)).filter(file => !file.endsWith('.summary.private.json'))
      .map(file => validateRunnerFailureEvidence(JSON.parse(readFileSync(join(root, name, file), 'utf8')))));
  return { root, result, report, receipt, records, accept() { accepted = true; } };
}

for (const selected of cases) {
  test(selected.name, t => {
    const run = runnerFixture(t, selected);
    const passing = selected.stage === 'expected';
    assert.equal(run.result.status, passing || selected.expectedFailure ? 0 : 1, 'original outcome is preserved');
    assert.equal(run.receipt.metadataReads, 1, 'real preflight rejects synthetic metadata before any subprocess');
    assert.equal(run.receipt.hasCheck, !selected.missing, 'safe startup wrapper receives the real fixed check');
    assert.equal(run.receipt.identicalFailure, passing ? undefined : true);
    assert.equal(run.receipt.identicalThrow, passing ? undefined : !selected.assertionFailure);
    assert.equal(run.receipt.rootExists, selected.cleanupFailure === true);
    assert.equal(run.receipt.cleanup.runRoot, selected.cleanupFailure ? 'retained' : 'removed');
    const sequence = run.receipt.events;
    assert.deepEqual(sequence, ['prepare', 'ownerCleanup', 'disposeApi',
      ...(selected.stage === 'vite' || passing ? ['stopBackend', 'backendStop', 'releaseWebPort'] : []),
      'releaseBackendPort', 'collectArtifacts', ...(selected.cleanupFailure ? [] : ['removeRoot']), 'report']);
    assert.equal(JSON.stringify(run.receipt.publicError).includes(marker), false, 'public error/cause/output excludes check');
    assert.equal(JSON.stringify(run.receipt.publicAttachments).includes(marker), false, 'public attachments exclude check');
    const relays = run.records.filter(record => record.phase === 'linuxHostPreflight');
    const shouldRead = !passing && !selected.expectedFailure;
    assert.equal(run.receipt.reads, shouldRead ? 1 : 0, 'only unexpected failure reads privately after cleanup');
    const shouldRecord = shouldRead && !selected.missing && !selected.readerFailure && !selected.sinkFailure;
    assert.equal(relays.length, shouldRecord ? 1 : 0, 'actual direct caller must deliver exactly one private check');
    if (shouldRecord) {
      const relay = relays[0];
      assert.equal(relay.runner, 'playwright');
      assert.deepEqual(relay.test, { ...run.receipt.test, line: null, column: null });
      assert.deepEqual(relay.binding, { kind: 'github', runId: '75401113', attempt: '1',
        job: 'composition-relay-synthetic', jobKey: 'composition-relay-synthetic',
        jobKeySource: 'githubJob', sourceRevision: 'a'.repeat(40) });
      assert.deepEqual(relay.exception, { chain: [{ name: null, message: marker, stack: null, truncated: false }], incomplete: true });
    }
    if (passing || selected.expectedFailure) assert.equal(run.records.length, 0, 'expected outcomes produce no failure records');
    run.accept();
  });
}
