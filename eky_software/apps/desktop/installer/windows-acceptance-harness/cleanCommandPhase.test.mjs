import assert from 'node:assert/strict';
import { lstat, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { acceptanceSingleProduct } from './acceptanceProductFacts.mjs';
import { runCleanInstallUninstallWorker } from './runCleanInstallUninstallWorker.mjs';
import { cleanupRunContext, createRunContext, startSupervisor } from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';

test('clean product classification retains the prior exact ProductState contract', () => {
  const state = { schemaVersion: 1, productState: -1, productName: 'Synthetic', productVersion: '0.2.7',
    localPackagePresent: true, ownedRegistryExists: true, ekyProcessCount: 0 };
  const classify = (value) => acceptanceSingleProduct({ inspectSourceAfter: { status: 'completed', resultCleanup: 'completed',
    state: Buffer.from(JSON.stringify(value)).toString('base64') } }, 'After');
  assert.deepEqual(classify(state), { status: 'completed', resultCode: 'exactProductAbsent', exactProductPresent: false });
  assert.deepEqual(classify({ ...state, productState: 5 }), { status: 'completed', resultCode: 'exactProductPresent', exactProductPresent: true });
  assert.deepEqual(acceptanceSingleProduct({}, 'After'), { status: 'failed', errorCode: 'productStateVerificationFailed' });
});

test('clean worker rejects malformed invocation before reading the filesystem', async () => {
  assert.equal(await runCleanInstallUninstallWorker([]), 64);
  assert.equal(await runCleanInstallUninstallWorker(['--request', null]), 64);
});

test('clean command rejects an unavailable temporary root before creating a fixture', {
  skip: process.platform !== 'win32', timeout: 40_000,
}, async (t) => {
  const context = await createRunContext('clean-missing-temp');
  let verified = false;
  t.after(() => cleanupRunContext(context, { preserveEvidence: !verified }));
  const temp = join(context.testRoot, 'missing');
  const profile = join(context.testRoot, 'profile');
  await mkdir(profile);
  const resultPath = join(context.testRoot, 'eky-clean-caller-' + 'a'.repeat(32), 'result.json');
  const execution = startSupervisor(context, { captureOutput: false,
    environment: { ...process.env, TEMP: temp, TMP: temp, APPDATA: profile },
    dotnetArguments: ['--clean-command', '--artifact-descriptor', join(context.testRoot, 'unused.json'),
      '--expected-descriptor-sha256', 'b'.repeat(64), '--expected-build-revision', 'c'.repeat(40), '--result-path', resultPath] });
  const events = [];
  execution.child.once('exit', () => events.push('exit'));
  execution.child.once('close', () => events.push('close'));
  const completion = await execution.completion;
  assert.equal(completion.exitCode, 1);
  assert.equal(completion.signal, null);
  assert.deepEqual(events, ['exit', 'close']);
  await assert.rejects(lstat(temp), { code: 'ENOENT' });
  await assert.rejects(lstat(resultPath), { code: 'ENOENT' });
  verified = true;
});
