import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { encryptArchive } from './workspaceEncryptedEvidence.mjs';
import { collectJobFailureEvidence } from './ciFailureEvidence.mjs';
import { prepareSmokeExceptionEvidence } from '../../scripts/packagedSmokeFailureEvidence.mjs';
import { writeLegacyDatabaseBuildInfoFixture } from './legacyUpgradeDatabaseEvidence.fixture.mjs';
import { createOpenPgpTestFixture } from './openPgpTestFixture.mjs';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

test('original failure evidence: installed runners and packaged ASAR through isolated TEST-key encryption', {
  skip: !['win32', 'linux'].includes(process.platform) ? 'Requires Windows or Linux with provisioned PowerShell/GnuPG; no installation.' : false,
  timeout: 240_000,
}, async t => {
  const fixture = await createOpenPgpTestFixture(ROOT);
  const { root, run, invokeGpg, generate, exportKey } = fixture;
  let completed = false;
  let failed = false;
  const check = async (name, body) => t.test(name, async () => {
    try { await body(); } catch (error) { failed = true; throw error; }
  });
  try {
    const recipient = await generate('recipient');
    await invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const publicPath = await exportKey(recipient, 'public.asc');
    for (const runner of ['node', 'vitest', 'playwright', 'native']) {
      await check(`${runner} original failure reaches a decrypted package through its real reporting boundary`, async () => {
        const directory = join(root, `runner-${runner}`);
        const temp = join(directory, 'temporary');
        const checkout = join(directory, 'checkout');
        await mkdir(temp, { recursive: true }); await mkdir(checkout);
        const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
          GITHUB_JOB: 'tests', EKY_EVIDENCE_JOB_KEY: 'tests-0', GITHUB_SHA: 'a'.repeat(40),
          EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
          TEMP: temp, TMP: temp, TMPDIR: temp, NODE_TEST_CONTEXT: undefined, CI: '1',
          REPORTER_TEST_SECRET: 'synthetic-secret-value',
          EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
          EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
          EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
        const original = `new Error('SYNTHETIC-${runner}-ORIGINAL ' + process.env.REPORTER_TEST_SECRET,
          { cause: new Error('SYNTHETIC-${runner}-CAUSE') })`;
        const fixturePath = join(directory, 'fixture.test.mjs');
        const moduleUrl = name => new URL(name, import.meta.url).href;
        let args;
        if (runner === 'native') {
          await writeFile(fixturePath, `import { executeWorkspaceCommandPhase } from ${JSON.stringify(moduleUrl('./workspaceCommandPhase.mjs'))};
            import { runWorkspaceSuccessWorker } from ${JSON.stringify(moduleUrl('./runWorkspaceSuccessWorker.mjs'))};
            import { createWorkspaceSuccessRequest } from ${JSON.stringify(moduleUrl('./workspaceSuccessContracts.mjs'))};
            import { fileURLToPath } from 'node:url';
            import { join } from 'node:path';
            process.argv[1] = fileURLToPath(${JSON.stringify(moduleUrl('./workspaceCommandPhase.mjs'))});
            const runRoot = join(process.cwd(), 'run');
            const fixtureRoot = join(runRoot, 'fixture');
            const request = createWorkspaceSuccessRequest({ runNonce: 'a'.repeat(64),
              artifactDescriptorSha256: 'b'.repeat(64), buildRevision: 'a'.repeat(40), fixtureRoot });
            const context = { phase: 'scenario', commandKind: 'workspace', scenarioRunNonce: request.runNonce,
              callerBinding: { artifactDescriptorSha256: request.artifactDescriptorSha256, buildRevision: request.buildRevision },
              state: { runRoot, artifact: { artifactRoot: fixtureRoot,
                source: { manifest: { packageFilename: 'source.msi' } },
                target: { manifest: { packageFilename: 'target.msi' } } } } };
            const result = await executeWorkspaceCommandPhase(context, {
              runScenario: (args, options) => runWorkspaceSuccessWorker(args, { ...options, platform: 'win32',
                readRequest: async () => request, verifyArtifact: async () => { throw ${original}; },
                writeResult: async () => {} }) });
            process.exitCode = result;`);
          args = [fixturePath];
        } else {
          const importName = runner === 'node' ? 'node:test' : runner === 'vitest'
            ? moduleUrl('../../../../node_modules/vitest/dist/index.js') : '@playwright/test';
          await writeFile(fixturePath, `import { test } from '${importName}';
            test('synthetic first failure', () => { throw ${original}; });`);
          if (runner === 'node') args = ['--test', '--test-reporter=' + moduleUrl('../../../../test-reporters/nodeFailureReporter.mjs'), fixturePath];
          if (runner === 'vitest') {
            const config = join(directory, 'vitest.config.mjs');
            await writeFile(config, `export default { test: { include: ['fixture.test.mjs'], maxWorkers: 1 } };`);
            args = [join(ROOT, 'node_modules/vitest/vitest.mjs'), 'run', '--config', config,
              '--reporter=default', '--reporter=' + fileURLToPath(new URL('../../../../test-reporters/vitestFailureReporter.mjs', import.meta.url))];
          }
          if (runner === 'playwright') {
            const config = join(directory, 'playwright.config.mjs');
            const reporter = fileURLToPath(new URL('../../../e2e/scripts/safeCiReporter.mjs', import.meta.url));
            await writeFile(config, `export default { testDir: '.', testMatch: 'fixture.test.mjs', workers: 1,
              reporter: [[${JSON.stringify(reporter)}, { silent: true }]] };`);
            args = [join(ROOT, 'apps/e2e/node_modules/@playwright/test/cli.js'), 'test', '--config', config];
            // Resolve the existing package from the fixture without installing anything.
            await writeFile(fixturePath, `import { test } from ${JSON.stringify(new URL('../../../e2e/node_modules/@playwright/test/index.mjs', import.meta.url).href)};
              test('synthetic first failure', () => { throw ${original}; });`);
          }
        }
        const child = await run(process.execPath, args, 30_000, { env, cwd: directory });
        assert.equal(child.status, 1, 'OPENPGP_RUNNER_FAILURE_EXPECTED');
        const collected = await collectJobFailureEvidence(env);
        await encryptArchive(collected.root, collected);
        const decrypted = await invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
        const value = JSON.parse(gunzipSync(decrypted.stdout));
        const records = value.manifest.files.filter(file => file.kind === 'runnerFailure' && file.status === 'retained')
          .map(file => JSON.parse(Buffer.from(value.files[file.name], 'base64')));
        const record = records.find(item => item.kind === 'runnerFailure' && item.runner === runner);
        assert.equal(record !== undefined, true, 'OPENPGP_RUNNER_ORIGINAL_MISSING');
        assert.equal(record.exception.chain.some(part => part.message?.includes(`SYNTHETIC-${runner}-ORIGINAL`)), true);
        const expectedCause = `${runner === 'playwright' ? 'Error: ' : ''}SYNTHETIC-${runner}-CAUSE`;
        assert.equal(record.exception.chain.some(part => part.message === expectedCause), true);
        assert.equal(record.exception.chain.some(part => part.stack?.includes(`SYNTHETIC-${runner}-ORIGINAL`)), true);
        assert.equal(JSON.stringify(records).includes('synthetic-secret-value'), false);
        assert.equal(records.some(item => item.kind === 'runnerFailureSummary' && item.status === 'recorded'), true);
        assert.equal(value.manifest.jobOutcome, 'failure');
        assert.equal(value.manifest.cleanup, 'notInferred');
      });
    }
    await check('locally caught workspace semantic original survives safe conversion and real decryption', async () => {
      const directory = join(root, 'semantic');
      const temp = join(directory, 'temporary');
      const checkout = join(directory, 'checkout');
      await mkdir(temp, { recursive: true }); await mkdir(checkout);
      const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'tests', EKY_EVIDENCE_JOB_KEY: 'tests-0', GITHUB_SHA: 'a'.repeat(40),
        EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
        TEMP: temp, TMP: temp, TMPDIR: temp, NODE_TEST_CONTEXT: undefined,
        EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
      const moduleUrl = name => new URL(name, import.meta.url).href;
      const fixturePath = join(directory, 'semantic.mjs');
      await writeFile(fixturePath, `import assert from 'node:assert/strict';
        import { mkdir } from 'node:fs/promises';
        import { join } from 'node:path';
        import { fileURLToPath } from 'node:url';
        import { executeWorkspaceCommandPhase } from ${JSON.stringify(moduleUrl('./workspaceCommandPhase.mjs'))};
        import { createNativeFailureEvidence } from ${JSON.stringify(moduleUrl('./nativeFailureEvidence.mjs'))};
        import { acceptanceProductPair } from ${JSON.stringify(moduleUrl('./acceptanceProductFacts.mjs'))};
        import { createWorkspaceSuccessRequest, validateWorkspaceSuccessResult, WORKSPACE_SUCCESS_PHASES,
          workspaceSuccessResultPath, writeJsonAtomicExclusive } from ${JSON.stringify(moduleUrl('./workspaceSuccessContracts.mjs'))};
        const phaseUrl = ${JSON.stringify(moduleUrl('./workspaceCommandPhase.mjs'))};
        process.argv[1] = fileURLToPath(phaseUrl);
        const runRoot = join(process.cwd(), 'run');
        const fixtureRoot = join(runRoot, 'fixture');
        const scenarioRoot = join(runRoot, 'scenario');
        await mkdir(scenarioRoot, { recursive: true });
        const request = createWorkspaceSuccessRequest({ runNonce: 'a'.repeat(64),
          artifactDescriptorSha256: 'b'.repeat(64), buildRevision: 'a'.repeat(40), fixtureRoot });
        const scenario = validateWorkspaceSuccessResult({ schemaVersion: 1, scenario: request.scenario,
          runNonce: request.runNonce, artifactDescriptorSha256: request.artifactDescriptorSha256,
          status: 'completed', resultCode: 'workspaceSuccessCompleted', errorCode: null, failedPhase: null,
          completedPhases: [...WORKSPACE_SUCCESS_PHASES] }, request);
        await writeJsonAtomicExclusive(workspaceSuccessResultPath(join(scenarioRoot, 'worker-request.json')), scenario);
        const absentState = { schemaVersion: 1, productState: -1, productName: null, productVersion: null,
          localPackagePresent: false, ownedRegistryExists: false, ekyProcessCount: 0 };
        const inspection = state => ({ schemaVersion: 1, nonce: 'c'.repeat(64), operation: 'inspect',
          status: 'completed', state: Buffer.from(JSON.stringify(state)).toString('base64'),
          errorCode: null, resultCleanup: 'completed' });
        const context = { phase: 'semantic', commandKind: 'workspaceSuccess', scenarioRunNonce: request.runNonce,
          callerBinding: { artifactDescriptorSha256: request.artifactDescriptorSha256, buildRevision: request.buildRevision },
          reports: { scenario: { status: 'completed', processTreeAbsent: true, processResultCode: 'processCompleted',
            workerResultCode: 'workerResultValidated', cleanupResultCode: 'notRequired', childExitCode: 0 } },
          state: { runRoot, semanticProof: null, sessionProof: null,
            products: { inspectSourceBefore: inspection(absentState), inspectTargetBefore: inspection(absentState),
              inspectSourceAfter: inspection({ ...absentState, ownedRegistryExists: true }),
              inspectTargetAfter: inspection({ ...absentState, productState: 5, ownedRegistryExists: true }) },
            artifact: { artifactRoot: fixtureRoot, source: { manifest: { packageFilename: 'source.msi' } },
              target: { manifest: { packageFilename: 'target.msi' } } } } };
        assert.equal(acceptanceProductPair(context.state.products, 'Before').resultCode, 'exactProductsAbsent');
        assert.equal(acceptanceProductPair(context.state.products, 'After').resultCode, 'targetProductPresent');
        const observeFailure = createNativeFailureEvidence(phaseUrl, request);
        let semanticCalls = 0;
        let result;
        try {
          result = await executeWorkspaceCommandPhase(context, { observeFailure, verifySemantic: async runtime => {
            semanticCalls++;
            assert.deepEqual(runtime.request, request);
            throw new Error('SYNTHETIC-SEMANTIC-ORIGINAL', { cause: new Error('SYNTHETIC-SEMANTIC-CAUSE') });
          } });
        } finally { await observeFailure.finish(); }
        assert.equal(semanticCalls, 1);
        assert.equal(result, 0);
        assert.deepEqual(context.state.semanticProof, { status: 'failed', errorCode: 'unexpectedFailure' });
        process.stdout.write(JSON.stringify(context.state.semanticProof));
      `);
      const child = await run(process.execPath, [fixturePath], 30_000, { env, cwd: directory });
      assert.equal(child.status, 0, 'OPENPGP_SEMANTIC_PHASE_CONTRACT_FAILED');
      assert.deepEqual(JSON.parse(child.stdout), { status: 'failed', errorCode: 'unexpectedFailure' });
      assert.equal(child.stderr.includes(Buffer.from('SYNTHETIC-SEMANTIC')), false);
      const collected = await collectJobFailureEvidence(env);
      await encryptArchive(collected.root, collected);
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
      const value = JSON.parse(gunzipSync(decrypted.stdout));
      const records = value.manifest.files.filter(file => file.kind === 'runnerFailure' && file.status === 'retained')
        .map(file => JSON.parse(Buffer.from(value.files[file.name], 'base64')));
      const failures = records.filter(record => record.kind === 'runnerFailure');
      assert.equal(failures.length, 1);
      assert.equal(failures[0].runner, 'native');
      assert.equal(failures[0].phase, 'semantic');
      assert.equal(failures[0].exception.chain[0].message, 'SYNTHETIC-SEMANTIC-ORIGINAL');
      assert.equal(failures[0].exception.chain[1].message, 'SYNTHETIC-SEMANTIC-CAUSE');
      assert.match(failures[0].exception.chain[0].stack, /SYNTHETIC-SEMANTIC-ORIGINAL/);
      assert.equal(records.some(record => record.kind === 'runnerFailureSummary' && record.status === 'recorded'), true);
      assert.equal(value.manifest.jobOutcome, 'failure');
      assert.equal(value.manifest.cleanup, 'notInferred');
    });
    await check('source quota retains FIRST original and the 128-record summary after real encryption and decryption', async () => {
      const directory = join(root, 'quota');
      const temp = join(directory, 'temporary');
      const checkout = join(directory, 'checkout');
      await mkdir(temp, { recursive: true }); await mkdir(checkout);
      const env = { GITHUB_ACTIONS: 'true', GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
        GITHUB_JOB: 'tests', EKY_EVIDENCE_JOB_KEY: 'tests-0', GITHUB_SHA: 'a'.repeat(40),
        EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
        NODE_TEST_CONTEXT: undefined, EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
      const sinkUrl = new URL('../../../../test-reporters/runnerFailureEvidence.mjs', import.meta.url).href;
      const child = await run(process.execPath, ['--input-type=module', '-e', `
        import { createRunnerFailureSink, RUNNER_FAILURE_LIMIT } from ${JSON.stringify(sinkUrl)};
        const sink = createRunnerFailureSink({ tempRoot: process.env.RUNNER_TEMP });
        if (RUNNER_FAILURE_LIMIT !== 128) process.exit(2);
        for (let i = 0; i < RUNNER_FAILURE_LIMIT; i++) sink.record({ runner: 'node', phase: 'testFailure',
          testName: 'quota ' + i, attempt: 0,
          error: new Error(i === 0 ? 'FIRST-QUOTA-ORIGINAL' : 'LATER-QUOTA-' + i) });
        const result = await sink.flush();
        process.exitCode = result.status === 'recorded' && result.recorded === 128 ? 1 : 2;
      `], 30_000, { env, cwd: directory });
      assert.equal(child.status, 1, 'OPENPGP_QUOTA_FAILURE_EXPECTED');
      const collected = await collectJobFailureEvidence(env);
      await encryptArchive(collected.root, collected);
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
      const value = JSON.parse(gunzipSync(decrypted.stdout));
      const source = value.manifest.sources.find(item => item.area === 'temporary' && item.location === 'runnerTemp');
      assert.equal(source.status, 'limited');
      const entries = value.manifest.files.filter(item => item.kind === 'runnerFailure' && item.status === 'retained');
      assert.equal(entries.length, source.fileLimit);
      const records = entries.map(item => JSON.parse(Buffer.from(value.files[item.name], 'base64')));
      assert.equal(records[0].kind, 'runnerFailureSummary');
      assert.equal(records[0].status, 'recorded');
      assert.equal(records[0].recorded, 128);
      assert.equal(records[0].recordLimit, 128);
      assert.equal(records[1].kind, 'runnerFailure');
      assert.equal(records[1].sequence, 1);
      assert.equal(records[1].exception.chain[0].message, 'FIRST-QUOTA-ORIGINAL');
      assert.equal(records.some(item => item.kind === 'runnerFailure' && item.sequence === 128), false);
      assert.equal(value.manifest.jobOutcome, 'failure');
      assert.equal(value.manifest.cleanup, 'notInferred');
    });
    await check('packaged original survives safe-code replacement, process exit and encrypted job delivery', async () => {
      const tempCandidate = join(root, 'packaged-exception-temp');
      await mkdir(tempCandidate);
      const temp = await realpath(tempCandidate);
      const checkout = join(root, 'packaged-exception-checkout');
      const installRoot = join(root, 'packaged-exception-install');
      const smokeToken = 'c'.repeat(32);
      const smokeRootDirectory = join(temp, 'eky-desktop-smoke', smokeToken);
      await mkdir(join(smokeRootDirectory, 'result'), { recursive: true });
      await mkdir(checkout);
      await writeLegacyDatabaseBuildInfoFixture(installRoot, { schemaVersion: 1, appVersion: '0.2.81',
        buildRevision: 'a'.repeat(40), buildDirty: false, buildCreatedAt: '2026-10-14T00:00:00.000Z' });
      const prepared = await prepareSmokeExceptionEvidence({ tempPath: temp, smokeRootDirectory, smokeToken, installRoot });
      assert.deepEqual(prepared.arguments, ['--startup-exception-evidence']);
      const input = { enabled: true, tempPath: temp, userDataPath: join(smokeRootDirectory, 'user-data'),
        token: prepared.environment.EKY_STARTUP_EXCEPTION_TOKEN, appVersion: '0.2.81', buildRevision: 'a'.repeat(40),
        runtimeInstanceId: '12345678-1234-4abc-8abc-1234567890ab' };
      const moduleUrl = new URL('../../src/main/startupExceptionEvidence.ts', import.meta.url).href;
      const child = await run(process.execPath, ['--input-type=module', '-e', `
        import { createStartupExceptionCapture } from ${JSON.stringify(moduleUrl)};
        const capture = createStartupExceptionCapture(${JSON.stringify(input)});
        if (!capture) process.exit(2);
        try { throw new Error('SYNTHETIC-PACKAGED-ORIGINAL', { cause: new Error('SYNTHETIC-CAUSE secret=test-secret') }); }
        catch (error) {
          capture(error, 'packagedSmoke', ['test-secret']);
          capture(new Error('PACKAGED_SMOKE_FAILED'), 'earlyStartup');
          if (await capture.waitForDelivery() !== 'recorded') process.exit(2);
          console.error('PACKAGED_SMOKE_FAILED'); process.exit(1);
        }`]);
      assert.equal(child.status, 1);
      assert.equal(child.stderr.toString().trim(), 'PACKAGED_SMOKE_FAILED');
      const env = { GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'electron',
        EKY_EVIDENCE_JOB_KEY: 'core-electron-0', GITHUB_SHA: 'a'.repeat(40), EKY_EVIDENCE_JOB_OUTCOME: 'failure',
        RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout, EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint, EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
      const collected = await collectJobFailureEvidence(env);
      await encryptArchive(collected.root, collected);
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
      const value = JSON.parse(gunzipSync(decrypted.stdout));
      const entry = value.manifest.files.find(file => file.kind === 'startupException');
      assert.equal(entry?.status, 'retained');
      const bytes = Buffer.from(value.files[entry.name], 'base64');
      assert.equal(entry.sha256, createHash('sha256').update(bytes).digest('hex'));
      const record = JSON.parse(bytes);
      assert.equal(record.stage, 'packagedSmoke');
      assert.equal(record.chain[0].message, 'SYNTHETIC-PACKAGED-ORIGINAL');
      assert.match(record.chain[0].stack, /SYNTHETIC-PACKAGED-ORIGINAL/u);
      assert.match(record.chain[1].message, /SYNTHETIC-CAUSE/u);
      assert.equal(bytes.includes(Buffer.from('test-secret')), false);
      assert.equal(bytes.includes(Buffer.from('PACKAGED_SMOKE_FAILED')), false);
      assert.equal(value.manifest.jobOutcome, 'failure');
      assert.equal(value.manifest.cleanup, 'notInferred');
    });
    completed = true;
  } finally {
    await fixture.finish({ completed, failed });
  }
});
