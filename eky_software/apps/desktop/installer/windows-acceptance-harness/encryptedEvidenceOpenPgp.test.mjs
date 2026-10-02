import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import test from 'node:test';
import { prepareEvidence, collectEvidence, encryptArchive } from './workspaceEncryptedEvidence.mjs';
import { collectJobFailureEvidence } from './ciFailureEvidence.mjs';

const SCRIPT = fileURLToPath(new URL('./encryptedEvidenceOpenPgp.ps1', import.meta.url));
const ROOT = resolve(dirname(SCRIPT), '../../../..');
const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const gpgPath = (value) => /^[A-Za-z]:[\\/]/u.test(value)
  ? `/${value[0].toLowerCase()}${value.slice(2).replaceAll('\\', '/')}` : value;
const SUCCESS = { Status: 'encrypted', Format: 'OpenPGP', Cipher: 'AES256' };

test('OpenPGP evidence: real isolated TEST keys and closed failure boundaries', {
  skip: process.platform !== 'win32' ? 'Requires native Windows pwsh.exe and existing Git GnuPG; no installation.' : false,
  timeout: 240_000,
}, async (t) => {
  await mkdir(join(ROOT, '.eky-local'), { recursive: true });
  const root = await mkdtemp(join(ROOT, '.eky-local', 'openpgp-test-'));
  const homes = [];
  let gpg;
  let gpgconf;
  let completed = false;
  let failed = false;
  let sequence = 0;
  const run = async (executable, args, timeout = 30_000) => {
    const result = spawnSync(executable, args, {
      encoding: 'buffer', timeout, maxBuffer: 128 * 1024, windowsHide: true,
      env: { ...process.env, GNUPGHOME: gpgPath(join(root, 'unused-home')), GPG_AGENT_INFO: '' },
    });
    const prefix = join(root, `process-${sequence++}`);
    await writeFile(`${prefix}.stdout.private.log`, result.stdout ?? Buffer.alloc(0));
    await writeFile(`${prefix}.stderr.private.log`, result.stderr ?? Buffer.alloc(0));
    if (result.error) {
      await writeFile(`${prefix}.failure.private.log`, String(result.error));
      throw new Error('OPENPGP_TEST_PROCESS_FAILED');
    }
    return result;
  };
  const ps = async (body, timeout) => run('pwsh.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand',
    Buffer.from(`$ErrorActionPreference = 'Stop'; ${body}`, 'utf16le').toString('base64')], timeout);
  const invokeGpg = async (home, args, expectSuccess = true) => {
    const result = await run(gpg, ['--no-options', '--homedir', gpgPath(home), '--batch', '--no-tty',
      '--disable-dirmngr', '--no-auto-key-retrieve', '--auto-key-locate', 'clear', ...args.map(gpgPath)]);
    if (expectSuccess) assert.equal(result.status, 0, 'OPENPGP_TEST_GPG_FAILED');
    return result;
  };
  const generate = async (label, options = []) => {
    const home = join(root, label);
    await mkdir(home);
    homes.push(home);
    // Only ephemeral, passphrase-free TEST keys; never a user's GnuPG home.
    await invokeGpg(home, [...options, '--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-generate-key', `Evidence TEST ${label} <${label}@example.invalid>`, 'ed25519', 'cert,sign', '1d']);
    const listing = await invokeGpg(home, ['--with-colons', '--list-keys']);
    const fingerprint = listing.stdout.toString('utf8').split(/\r?\n/u)
      .find((line) => line.startsWith('fpr:'))?.split(':')[9];
    assert.equal(/^[A-F0-9]{40}$/u.test(fingerprint), true, 'OPENPGP_TEST_FINGERPRINT_MISSING');
    return { home, fingerprint };
  };
  const exportKey = async (key, name, secret = false) => {
    const path = join(root, name);
    await invokeGpg(key.home, ['--pinentry-mode', 'loopback', '--passphrase', '', '--armor', '--output', path,
      secret ? '--export-secret-keys' : '--export', key.fingerprint]);
    return path;
  };
  const check = async (name, body) => t.test(name, async () => {
    try { await body(); } catch (error) { failed = true; throw error; }
  });
  try {
    const discovered = await ps(`$git = (Get-Command git.exe -CommandType Application | Select-Object -First 1).Source;
      $dir = [IO.Path]::GetDirectoryName($git); $gpg = $null;
      foreach ($relative in @('../usr/bin/gpg.exe', '../../usr/bin/gpg.exe')) {
        $candidate = [IO.Path]::GetFullPath([IO.Path]::Combine($dir, $relative));
        if ([IO.File]::Exists($candidate)) { $gpg = $candidate; break }
      }
      if (!$gpg) { throw 'OPENPGP_TEST_GPG_UNAVAILABLE' }
      @{ gpg = $gpg; gpgconf = (Join-Path ([IO.Path]::GetDirectoryName($gpg)) 'gpgconf.exe') } | ConvertTo-Json -Compress`);
    assert.equal(discovered.status, 0, 'OPENPGP_TEST_TOOL_DISCOVERY_FAILED');
    ({ gpg, gpgconf } = JSON.parse(discovered.stdout.toString('utf8')));
    const recipient = await generate('recipient');
    await invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
      '--quick-add-key', recipient.fingerprint, 'cv25519', 'encr', '1d']);
    const other = await generate('other');
    const publicPath = await exportKey(recipient, 'public.asc');
    const secretPath = await exportKey(recipient, 'secret.private.asc', true);
    const signingOnly = await exportKey(other, 'signing-only.asc');
    const archive = join(root, "private input ' [1].json.gz");
    const plaintext = Buffer.from('SYNTHETIC-PRIVATE-EVIDENCE\0arbitrary archive bytes\n'.repeat(50));
    await writeFile(archive, plaintext);
    let invocation = 0;
    const encrypt = async (overrides = {}, beforeInvocation = '') => {
      const work = join(root, `work-${invocation++}`);
      await mkdir(work);
      const output = overrides.OutputPath ?? join(root, `ciphertext-${invocation}.gpg`);
      const parameters = { ArchivePath: archive, OutputPath: output, PublicKeyPath: publicPath,
        ExpectedFingerprint: recipient.fingerprint, WorkRoot: work, ...overrides };
      const args = Object.entries(parameters).map(([key, value]) => `-${key} ${quote(value)}`).join(' ');
      const result = await ps(`${beforeInvocation}; . ${quote(SCRIPT)};
        try { Invoke-EvidenceEncryption ${args} | ConvertTo-Json -Compress }
        catch { [Console]::Error.Write($_.Exception.Message); exit 17 }`, 140_000);
      return { ...result, output, work };
    };
    const rejected = async (overrides, code) => {
      const result = await encrypt(overrides);
      assert.equal(result.status, 17, 'OPENPGP_TEST_REJECTION_MISSING');
      assert.equal(result.stdout.length, 0, 'OPENPGP_TEST_UNSAFE_STDOUT');
      assert.equal(result.stderr.toString('utf8') === code, true, 'OPENPGP_TEST_UNSAFE_ERROR');
      assert.equal((await readdir(root)).includes(result.output.slice(root.length + 1)), false,
        'OPENPGP_TEST_FAILED_OUTPUT_PUBLISHED');
      assert.equal((await readFile(archive)).equals(plaintext), true, 'OPENPGP_TEST_SOURCE_CHANGED');
      return result;
    };
    let sealed;
    await check('roundtrip AES256, isolated home, default Git tool discovery, bounded safe result', async () => {
      sealed = await encrypt();
      assert.equal(sealed.status, 0, 'OPENPGP_TEST_ENCRYPTION_FAILED');
      assert.equal(sealed.stderr.length, 0, 'OPENPGP_TEST_STDERR_EXPOSED');
      assert.deepEqual(JSON.parse(sealed.stdout.toString('utf8')), SUCCESS);
      const ciphertext = await readFile(sealed.output);
      assert.equal(ciphertext.includes(plaintext.subarray(0, 24)), false, 'OPENPGP_TEST_PLAINTEXT_PUBLISHED');
      const decrypted = await invokeGpg(recipient.home, ['--pinentry-mode', 'loopback', '--passphrase', '',
        '--status-fd', '2', '--decrypt', sealed.output]);
      assert.equal(decrypted.stdout.equals(plaintext), true, 'OPENPGP_TEST_ROUNDTRIP_MISMATCH');
      assert.equal(/\[GNUPG:\] DECRYPTION_INFO 2 9(?: 0)?\r?\n/u.test(decrypted.stderr.toString('utf8')),
        true, 'OPENPGP_TEST_CIPHER_MISMATCH');
      const entries = await readdir(sealed.work);
      assert.equal(entries.length, 1);
      const privateRoot = join(sealed.work, entries[0]);
      const homeEntries = await readdir(privateRoot);
      if (homeEntries.includes('private-keys-v1.d')) {
        assert.equal((await readdir(join(privateRoot, 'private-keys-v1.d'))).length, 0,
          'OPENPGP_TEST_SECRET_STORAGE_CREATED');
      }
      assert.equal((await readdir(privateRoot)).includes('encrypt.stderr.private.log'), true);
    });
    await check('multiple Git applications use the first PATH match just like the tool preflight', async () => {
      const gitRoot = resolve(dirname(gpg), '../..');
      const gitBin = join(gitRoot, 'bin');
      const gitCmd = join(gitRoot, 'cmd');
      const prefix = `$env:Path = ${quote(gitBin + ';' + gitCmd + ';')} + $env:Path;
        if (@(Get-Command git.exe -CommandType Application).Count -lt 2) { throw 'OPENPGP_TEST_MULTIPLE_GIT_REQUIRED' }`;
      const result = await encrypt({}, prefix);
      assert.equal(result.status, 0, 'OPENPGP_TEST_MULTIPLE_GIT_ENCRYPTION_FAILED');
      assert.equal(result.stderr.length, 0, 'OPENPGP_TEST_MULTIPLE_GIT_UNSAFE_ERROR');
      assert.deepEqual(JSON.parse(result.stdout.toString('utf8')), SUCCESS);
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', result.output]);
      assert.equal(decrypted.stdout.equals(plaintext), true, 'OPENPGP_TEST_MULTIPLE_GIT_ROUNDTRIP_FAILED');
    });
    await check('collector -> PowerShell entry -> OpenPGP -> decrypt preserves the trace and manifest', async () => {
      const temp = join(root, 'runner-temp');
      await mkdir(temp);
      const env = { RUNNER_TEMP: temp, GITHUB_RUN_ID: '12345', GITHUB_RUN_ATTEMPT: '1',
        EKY_WORKSPACE_REPETITION: '1', EXPECTED_BUILD_REVISION: 'a'.repeat(40),
        EXPECTED_DESCRIPTOR_SHA256: 'b'.repeat(64), EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8'),
        EKY_TEST_OUTCOME: 'failure', EKY_ARTIFACT_OUTCOME: 'success', EKY_CAPTURE_START_OUTCOME: 'success',
        EKY_CAPTURE_STOP_OUTCOME: 'success', EKY_ANALYSIS_OUTCOME: 'failure' };
      const prepared = await prepareEvidence(env);
      const capture = join(temp, 'eky-inspector-capture');
      await mkdir(capture);
      const trace = Buffer.alloc(131_077, 0x89);
      await writeFile(join(capture, 'stopped'), '');
      await writeFile(join(capture, 'capture.etl'), trace);
      const collected = await collectEvidence(env, prepared.root);
      await encryptArchive(prepared.root, collected);
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', join(prepared.root, 'evidence.json.gz.gpg')]);
      const value = JSON.parse(gunzipSync(decrypted.stdout));
      assert.equal(Buffer.from(value.files['capture.etl'], 'base64').equals(trace), true);
      const entry = value.manifest.files.find((file) => file.name === 'capture.etl');
      assert.equal(entry.sha256, createHash('sha256').update(trace).digest('hex'));
      assert.equal(entry.bytes, trace.length);
      assert.equal(value.manifest.captureClosed, true);
      assert.equal(value.manifest.outcomes.test, 'failure');
      assert.equal(value.manifest.cleanup, 'unverified');
      assert.equal(value.manifest.unresolvedEvidenceHold, true);
    });
    await check('failed child output and native cleanup result survive job collection, encryption and real decryption', async () => {
      const temp = join(root, 'job-runner-temp');
      const checkout = join(root, 'job-checkout');
      const native = join(temp, 'eky supervisor abc');
      await mkdir(native, { recursive: true }); await mkdir(checkout);
      const failed = await run(process.execPath, ['-e', 'console.error("SYNTHETIC-FIRST-FAILURE"); process.exit(9)']);
      assert.equal(failed.status, 9);
      await writeFile(join(native, 'ci-step.stderr.private'), failed.stderr);
      await writeFile(join(native, 'result.json'), JSON.stringify({ cleanupWin32ErrorCode: 5, processTreeAbsent: false }));
      const reportRoot = join(checkout, 'eky_software/apps/e2e/playwright-report/run-aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
      await mkdir(reportRoot, { recursive: true });
      const reportBytes = Buffer.from(JSON.stringify({ config: { secret: 'EXCLUDED-CONFIG' }, errors: [],
        suites: [{ specs: [{ tests: [{ results: [{ retry: 0, error: { message: 'first assertion', stack: 'synthetic stack' },
          attachments: [{ name: 'excluded', body: 'EXCLUDED-BODY' }] }, { retry: 1, status: 'passed' }] }] }] }] }));
      await writeFile(join(reportRoot, 'results.private.json'), reportBytes);
      const env = { GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'legacy_contracts',
        EKY_EVIDENCE_JOB_KEY: 'legacy-contracts-0', GITHUB_SHA: 'a'.repeat(40),
        EKY_EVIDENCE_JOB_OUTCOME: 'failure', RUNNER_TEMP: temp, GITHUB_WORKSPACE: checkout,
        EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint,
        EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8') };
      const collected = await collectJobFailureEvidence(env);
      await encryptArchive(collected.root, collected);
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', join(collected.root, 'evidence.json.gz.gpg')]);
      const value = JSON.parse(gunzipSync(decrypted.stdout));
      assert.equal(value.manifest.binding.attempt, '1');
      assert.equal(value.manifest.jobOutcome, 'failure');
      assert.equal(value.manifest.cleanup, 'notInferred');
      assert.equal(value.manifest.files.length, 3);
      const original = value.manifest.files.find(file => file.source.endsWith('ci-step.stderr.private'));
      assert.equal(Buffer.from(value.files[original.name], 'base64').equals(failed.stderr), true);
      assert.equal(original.sha256, createHash('sha256').update(failed.stderr).digest('hex'));
      const reportEntry = value.manifest.files.find(file => file.kind === 'playwrightReport');
      const projected = Buffer.from(value.files[reportEntry.name], 'base64');
      assert.equal(reportEntry.sourceProof.sha256, createHash('sha256').update(reportBytes).digest('hex'));
      assert.equal(reportEntry.sha256, createHash('sha256').update(projected).digest('hex'));
      assert.notEqual(reportEntry.sourceProof.sha256, reportEntry.sha256);
      assert.equal(projected.toString().includes('EXCLUDED'), false);
      const results = JSON.parse(projected).suites[0].specs[0].tests[0].results;
      assert.equal(results[0].error.stack, 'synthetic stack');
      assert.deepEqual(results.map(result => result.retry), [0, 1]);
    });
    await check('synthetic delivery CLI seals only its fixed sample and preserves the real checkout binding', async () => {
      const temp = join(root, 'delivery-runner-temp');
      await mkdir(temp);
      const head = await run('git.exe', ['-C', ROOT, 'rev-parse', 'HEAD']);
      assert.equal(head.status, 0, 'OPENPGP_TEST_CHECKOUT_UNVERIFIED');
      const revision = head.stdout.toString('utf8').trim();
      assert.match(revision, /^[0-9a-f]{40}$/u);
      const eventPath = join(temp, 'event.json');
      const outputPath = join(temp, 'output.txt');
      await writeFile(eventPath, JSON.stringify({ inputs: { mode: 'encrypted-evidence-delivery-proof' } }));
      await writeFile(outputPath, '');
      const child = spawnSync(process.execPath, [join(dirname(SCRIPT), 'workspaceEncryptedEvidence.mjs'), 'delivery-proof'], {
        env: { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
          GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'encrypted-evidence-delivery-proof',
          EKY_EVIDENCE_DELIVERY_PROOF: '1', GITHUB_SHA: revision, GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
          RUNNER_TEMP: temp, GITHUB_OUTPUT: outputPath, GITHUB_EVENT_PATH: eventPath,
          EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8'),
          EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
          EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint },
        timeout: 130_000, maxBuffer: 64 * 1024, encoding: 'buffer', windowsHide: true,
      });
      await writeFile(join(root, 'delivery-cli.stdout.private.log'), child.stdout ?? Buffer.alloc(0));
      await writeFile(join(root, 'delivery-cli.stderr.private.log'), child.stderr ?? Buffer.alloc(0));
      assert.equal(child.error === undefined, true, 'OPENPGP_TEST_DELIVERY_PROCESS_FAILED');
      assert.equal(child.status, 0, 'OPENPGP_TEST_DELIVERY_SEAL_FAILED');
      assert.equal(child.stderr.length, 0, 'OPENPGP_TEST_DELIVERY_UNSAFE_ERROR');
      const report = JSON.parse(child.stdout.toString('utf8'));
      assert.equal(report.operation, 'syntheticEncryptedEvidenceDelivery');
      assert.equal(report.status, 'sealed');
      const ciphertextPath = join(await realpath(temp), 'eky-encrypted-delivery-proof-98765-1', 'evidence.json.gz.gpg');
      assert.equal(await readFile(outputPath, 'utf8') === `ciphertext=${ciphertextPath}\nsealed=true\n`,
        true, 'OPENPGP_TEST_DELIVERY_OUTPUT_MISMATCH');
      const decrypted = await invokeGpg(recipient.home, ['--decrypt', ciphertextPath]);
      const value = JSON.parse(gunzipSync(decrypted.stdout));
      assert.deepEqual(Object.keys(value.files), ['command-export.stderr.private.log']);
      const sample = Buffer.from('EKY synthetic encrypted delivery proof v1\n', 'utf8');
      assert.equal(Buffer.from(value.files['command-export.stderr.private.log'], 'base64').equals(sample), true);
      assert.equal(value.manifest.files[0].sha256, createHash('sha256').update(sample).digest('hex'));
      assert.equal(value.manifest.files[0].bytes, sample.length);
      assert.equal(value.manifest.binding.sourceRevision, revision);
      assert.equal(value.manifest.binding.runId, '98765');
      assert.equal(value.manifest.binding.attempt, '1');
      assert.equal(value.manifest.binding.artifactDescriptorSha256, undefined);
      assert.equal(Object.values(value.manifest.outcomes).every(outcome => outcome === 'skipped'), true);
      assert.equal(value.manifest.captureClosed, false);
    });
    const deliveryHead = await run('git.exe', ['-C', ROOT, 'rev-parse', 'HEAD']);
    assert.equal(deliveryHead.status, 0, 'OPENPGP_TEST_CHECKOUT_UNVERIFIED');
    const deliveryRevision = deliveryHead.stdout.toString('utf8').trim();
    assert.match(deliveryRevision, /^[0-9a-f]{40}$/u);
    assert.equal(process.versions.node === (await readFile(join(ROOT, '.node-version'), 'utf8')).trim(),
      true, 'OPENPGP_TEST_NODE_PIN_REQUIRED');
    const validDeliveryEvent = JSON.stringify({ inputs: { mode: 'encrypted-evidence-delivery-proof' } });
    const wrongRevision = `${deliveryRevision[0] === '0' ? '1' : '0'}${deliveryRevision.slice(1)}`;
    for (const [name, revision, event, phase, patch = {}] of [
      ['wrong-checkout', wrongRevision, validDeliveryEvent, 'checkoutRevision'],
      ['malformed-event', deliveryRevision, '{"inputs":', 'eventJson'],
      ['oversized-event', deliveryRevision, validDeliveryEvent.padEnd(1024 * 1024 + 1, ' '), 'eventFile'],
      ['unverified-recipient', deliveryRevision, validDeliveryEvent, 'evidenceCollection',
        { EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: '' }],
      ['recipient-mismatch', deliveryRevision, validDeliveryEvent, 'encryption',
        { EKY_DIAGNOSTIC_KEY_FINGERPRINT: other.fingerprint, EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: other.fingerprint }],
    ]) {
      await check(`delivery CLI reports ${phase} for ${name} without raw errors or output publication`, async () => {
        const temp = join(root, `delivery-rejected-${name}`);
        await mkdir(temp);
        const eventPath = join(temp, 'event.json');
        const outputPath = join(temp, 'output.txt');
        await writeFile(eventPath, event);
        await writeFile(outputPath, 'existing=value\n');
        const child = spawnSync(process.execPath, [join(dirname(SCRIPT), 'workspaceEncryptedEvidence.mjs'), 'delivery-proof'], {
          env: { ...process.env, GITHUB_ACTIONS: 'true', RUNNER_OS: 'Windows', RUNNER_ENVIRONMENT: 'github-hosted',
            GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_JOB: 'encrypted-evidence-delivery-proof',
            EKY_EVIDENCE_DELIVERY_PROOF: '1', GITHUB_SHA: revision, GITHUB_RUN_ID: '98765', GITHUB_RUN_ATTEMPT: '1',
            RUNNER_TEMP: temp, GITHUB_OUTPUT: outputPath, GITHUB_EVENT_PATH: eventPath,
            EKY_DIAGNOSTIC_PUBLIC_KEY: await readFile(publicPath, 'utf8'),
            EKY_DIAGNOSTIC_KEY_FINGERPRINT: recipient.fingerprint,
            EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: recipient.fingerprint, ...patch },
          timeout: 130_000, maxBuffer: 64 * 1024, encoding: 'buffer', windowsHide: true,
        });
        await writeFile(join(root, `delivery-${name}.stdout.private.log`), child.stdout ?? Buffer.alloc(0));
        await writeFile(join(root, `delivery-${name}.stderr.private.log`), child.stderr ?? Buffer.alloc(0));
        assert.equal(child.error === undefined, true, 'OPENPGP_TEST_DELIVERY_PROCESS_FAILED');
        assert.equal(child.status, 1, 'OPENPGP_TEST_DELIVERY_REJECTION_MISSING');
        assert.equal(child.stdout.length, 0, 'OPENPGP_TEST_DELIVERY_UNSAFE_STDOUT');
        const expectedFailure = JSON.stringify({ schemaVersion: 1, operation: 'syntheticEncryptedEvidenceDelivery',
          status: 'failed', phase, ...(phase === 'encryption' ? { errorCode: 'EVIDENCE_KEY_INVALID' } : {}) }) +
          '\nWORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED\n';
        assert.equal(child.stderr.toString('utf8') === expectedFailure,
          true, 'OPENPGP_TEST_DELIVERY_UNSAFE_ERROR');
        assert.equal(await readFile(outputPath, 'utf8') === 'existing=value\n',
          true, 'OPENPGP_TEST_FAILED_OUTPUT_PUBLISHED');
        if (phase !== 'encryption') {
          assert.deepEqual((await readdir(temp)).sort(), ['event.json', 'output.txt'],
            'OPENPGP_TEST_REJECTED_INPUT_PREPARED_EVIDENCE');
        } else {
          await assert.rejects(readFile(join(temp, 'eky-encrypted-delivery-proof-98765-1', 'evidence.json.gz.gpg')),
            { code: 'ENOENT' });
        }
      });
    }
    await check('real missing PowerShell distinguishes startup without changing the normal failure result', async () => {
      const script = `import { encryptArchive } from ${JSON.stringify(new URL('./workspaceEncryptedEvidence.mjs', import.meta.url).href)};
        for (const detailed of [false, true]) {
          try { await encryptArchive(${JSON.stringify(root)}, { archivePath: ${JSON.stringify(archive)},
            fingerprint: ${JSON.stringify(recipient.fingerprint)} }, detailed); process.exitCode = 2; }
          catch (error) { console.log(JSON.stringify({ message: error.message, code: error.evidenceCode ?? null })); }
        }`;
      const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path')), Path: root },
        encoding: 'buffer', timeout: 10000, maxBuffer: 4096, windowsHide: true,
      });
      await writeFile(join(root, 'missing-helper.stdout.private.log'), child.stdout ?? Buffer.alloc(0));
      await writeFile(join(root, 'missing-helper.stderr.private.log'), child.stderr ?? Buffer.alloc(0));
      assert.equal(child.error === undefined && child.status === 0, true, 'OPENPGP_TEST_MISSING_HELPER_FAILED');
      assert.equal(child.stderr.length, 0, 'OPENPGP_TEST_MISSING_HELPER_RAW_ERROR');
      const lines = child.stdout.toString('utf8').trim().split('\n').map(line => JSON.parse(line));
      assert.deepEqual(lines, [
        { message: 'WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED', code: null },
        { message: 'WORKSPACE_ENCRYPTED_EVIDENCE_UNVERIFIED', code: 'EVIDENCE_HELPER_START_FAILED' },
      ]);
    });
    await check('modified ciphertext and wrong private key cannot decrypt successfully', async () => {
      assert.equal(sealed?.status, 0, 'OPENPGP_TEST_ROUNDTRIP_REQUIRED');
      const tampered = await readFile(sealed.output);
      tampered[tampered.length - 1] ^= 1;
      const tamperedPath = join(root, 'tampered.gpg');
      await writeFile(tamperedPath, tampered);
      const corrupt = await invokeGpg(recipient.home, ['--decrypt', tamperedPath], false);
      assert.notEqual(corrupt.status, 0, 'OPENPGP_TEST_MODIFICATION_ACCEPTED');
      const wrong = await invokeGpg(other.home, ['--decrypt', sealed.output], false);
      assert.notEqual(wrong.status, 0, 'OPENPGP_TEST_WRONG_KEY_ACCEPTED');
    });
    await check('wrong or short fingerprint and signing-only key fail before publication', async () => {
      await rejected({ ExpectedFingerprint: other.fingerprint }, 'EVIDENCE_KEY_INVALID');
      await rejected({ ExpectedFingerprint: recipient.fingerprint.slice(-16) }, 'EVIDENCE_KEY_INVALID');
      await rejected({ PublicKeyPath: signingOnly, ExpectedFingerprint: other.fingerprint }, 'EVIDENCE_KEY_INVALID');
    });
    await check('secret armor, disguised secret packets, multiple primaries and oversized armor are rejected', async () => {
      await rejected({ PublicKeyPath: secretPath }, 'EVIDENCE_KEY_INVALID');
      const disguised = join(root, 'disguised.private.asc');
      await writeFile(disguised, (await readFile(secretPath, 'utf8')).replaceAll('PRIVATE KEY BLOCK', 'PUBLIC KEY BLOCK'));
      await rejected({ PublicKeyPath: disguised }, 'EVIDENCE_KEY_INVALID');
      const multiple = join(root, 'multiple.asc');
      await invokeGpg(recipient.home, ['--import', signingOnly]);
      await invokeGpg(recipient.home, ['--armor', '--output', multiple, '--export']);
      await rejected({ PublicKeyPath: multiple }, 'EVIDENCE_KEY_INVALID');
      const large = join(root, 'oversized.asc');
      await writeFile(large, Buffer.alloc(256 * 1024 + 1, 65));
      await rejected({ PublicKeyPath: large }, 'EVIDENCE_KEY_INVALID');
    });
    await check('existing output stays byte-identical', async () => {
      const output = join(root, 'existing.gpg');
      await writeFile(output, 'existing ciphertext');
      const result = await encrypt({ OutputPath: output });
      assert.equal(result.status, 17);
      assert.equal(result.stderr.toString('utf8') === 'EVIDENCE_OUTPUT_EXISTS', true);
      assert.equal(await readFile(output, 'utf8'), 'existing ciphertext');
      assert.equal((await readdir(result.work)).length, 0);
    });
    await check('native failure retains raw stderr privately without plaintext publication', async () => {
      const result = await rejected({ GpgPath: process.execPath }, 'EVIDENCE_GPG_FAILED');
      const [directory] = await readdir(result.work);
      const errors = await readFile(join(result.work, directory, 'inspect.stderr.private.log'));
      assert.equal(errors.length > 0 && errors.length <= 65536, true, 'OPENPGP_TEST_PRIVATE_STDERR_MISSING');
    });
    await check('bounded pipe output and timeout stop the owned direct child', async () => {
      for (const [script, expected] of [
        ["process.stderr.write('PRIVATE-' + 'X'.repeat(100000))", 'EVIDENCE_GPG_OUTPUT_LIMIT'],
        ["process.stderr.write('PRIVATE-WAIT'); setInterval(() => {}, 1000)", 'EVIDENCE_GPG_TIMEOUT'],
      ]) {
        const errorPath = join(root, `bound-${sequence}.stderr.private.log`);
        const result = await ps(`. ${quote(SCRIPT)};
          try { Invoke-EvidenceGpgProcess -Executable ${quote(process.execPath)} -Arguments @('-e', ${quote(script)}) -HomePath ${quote(root)} -ErrorPath ${quote(errorPath)} -TimeoutMilliseconds 1000 -StreamLimitBytes 1024;
            exit 9 } catch { [Console]::Error.Write($_.Exception.Message); exit 17 }`);
        assert.equal(result.status, 17);
        assert.equal(result.stdout.length, 0);
        assert.equal(result.stderr.toString('utf8') === expected, true, 'OPENPGP_TEST_BOUNDARY_NOT_CLOSED');
        const retained = await readFile(errorPath);
        assert.equal(retained.length > 0 && retained.length <= 1024, true);
      }
    });
    await check('one shared deadline stops a real held GPG child and refuses later steps', async () => {
      const home = join(root, 'deadline-home');
      await mkdir(home);
      const errors = join(root, 'deadline.stderr.private.log');
      const result = await ps(`. ${quote(SCRIPT)};
        $before = @([Diagnostics.Process]::GetProcessesByName('gpg') | ForEach-Object { $_.Id });
        $clock = [Diagnostics.Stopwatch]::StartNew();
        $common = @{ Executable = ${quote(gpg)}; HomePath = ${quote(home)}; Lifetime = $clock;
          TotalBudgetMilliseconds = 1500; TimeoutMilliseconds = 30000 };
        $base = @('--no-options', '--homedir', ${quote(gpgPath(home))}, '--no-keyring', '--batch', '--no-tty',
          '--no-autostart', '--disable-dirmngr', '--no-auto-key-retrieve', '--auto-key-locate', 'clear');
        $null = Invoke-EvidenceGpgProcess @common -Arguments ($base + @('--version')) -ErrorPath ${quote(join(root, 'deadline-version.stderr.private.log'))};
        $timedOut = $false;
        try {
          # MSYS /dev/zero holds real encryption open without a child fixture or disk growth.
          $null = Invoke-EvidenceGpgProcess @common -Arguments ($base + @('--status-fd', '2', '--rfc4880',
            '--cipher-algo', 'AES256', '--compress-algo', 'none', '--recipient-file', ${quote(gpgPath(publicPath))},
            '--output', '/dev/null', '--yes', '--encrypt', '/dev/zero')) -ErrorPath ${quote(errors)};
        } catch { $timedOut = $_.Exception.Message -ceq 'EVIDENCE_GPG_TIMEOUT' }
        if (!$timedOut -or $clock.ElapsedMilliseconds -gt 4500) { throw 'OPENPGP_TEST_DEADLINE_FAILED' }
        $remaining = @([Diagnostics.Process]::GetProcessesByName('gpg') | Where-Object { $_.Id -notin $before });
        if ($remaining.Count -ne 0) { throw 'OPENPGP_TEST_CHILD_REMAINS' }
        if (![IO.File]::ReadAllText(${quote(errors)}).Contains('[GNUPG:] BEGIN_ENCRYPTION')) {
          throw 'OPENPGP_TEST_REAL_ENCRYPTION_NOT_STARTED'
        }
        $late = ${quote(join(root, 'deadline-late.stderr.private.log'))};
        try { $null = Invoke-EvidenceGpgProcess @common -Arguments ($base + @('--version')) -ErrorPath $late;
          throw 'OPENPGP_TEST_LATE_START' } catch {
          if ($_.Exception.Message -cne 'EVIDENCE_GPG_TIMEOUT') { throw 'OPENPGP_TEST_LATE_START' }
        }
        if (Test-Path -LiteralPath $late) { throw 'OPENPGP_TEST_LATE_SIDE_EFFECT' }
        exit 0`);
      assert.equal(result.status, 0, 'OPENPGP_TEST_REAL_CHILD_DEADLINE_FAILED');
      assert.equal(result.stdout.length, 0);
      assert.equal(result.stderr.length, 0);
    });
    await check('approved key-profile metadata rejects weak and unsupported encryption keys', async () => {
      const record = (type, bits, algorithm, capability, curve = '') => {
        const fields = Array(18).fill('');
        Object.assign(fields, { 0: type, 1: '-', 2: String(bits), 3: String(algorithm),
          5: String(Math.floor(Date.now() / 1000) - 60), 11: capability, 16: curve });
        return fields.join(':');
      };
      const listing = (primary, sub) => `${primary}\nfpr:::::::::${'A'.repeat(40)}:\n${sub ?? ''}`;
      const ed = record('pub', 255, 22, 'scESC', 'ed25519');
      const cv = record('sub', 255, 18, 'e', 'cv25519');
      const rsa = record('pub', 3072, 1, 'scESC');
      const cases = [
        { listing: listing(ed, cv), valid: true },
        { listing: listing(record('pub', 3072, 1, 'escESC')), valid: true },
        { listing: listing(rsa, record('sub', 4096, 1, 'e')), valid: true },
        { listing: listing(record('pub', 1024, 1, 'escESC')), valid: false },
        { listing: listing(record('pub', 2048, 1, 'escESC')), valid: false },
        { listing: listing(rsa, record('sub', 1024, 1, 'e')), valid: false },
        { listing: listing(rsa, record('sub', 2048, 1, 'e')), valid: false },
        { listing: listing(ed, record('sub', 255, 18, 'e', 'unknown')), valid: false },
        { listing: listing(ed, record('sub', 256, 18, 'e', 'nistp256')), valid: false },
        { listing: listing(ed, record('sub', 255, 99, 'e', 'cv25519')), valid: false },
        { listing: listing(record('pub', 255, 99, 'scESC', 'ed25519'), cv), valid: false },
      ];
      const result = await ps(`. ${quote(SCRIPT)};
        foreach ($case in (${quote(JSON.stringify(cases))} | ConvertFrom-Json)) {
          $accepted = $false;
          try { Confirm-EvidencePublicKey $case.listing ${quote('A'.repeat(40))}; $accepted = $true }
          catch { if ($_.Exception.Message -cne 'EVIDENCE_KEY_INVALID') { throw 'OPENPGP_TEST_PROFILE_ERROR' } }
          if ($accepted -ne $case.valid) { throw 'OPENPGP_TEST_PROFILE_MISMATCH' }
        }; exit 0`);
      assert.equal(result.status, 0, 'OPENPGP_TEST_KEY_PROFILE_FAILED');
      assert.equal(result.stdout.length, 0);
      assert.equal(result.stderr.length, 0);
    });
    await check('expired primary and revoked recipient fail closed', async () => {
      const past = `${Math.floor(Date.now() / 1000) - 3 * 86400}!`;
      const expired = await generate('expired', ['--faked-system-time', past]);
      const expiredPath = await exportKey(expired, 'expired.asc');
      await rejected({ PublicKeyPath: expiredPath, ExpectedFingerprint: expired.fingerprint }, 'EVIDENCE_KEY_INVALID');
      const revocation = await readFile(join(recipient.home, 'openpgp-revocs.d', `${recipient.fingerprint}.rev`), 'utf8');
      const revokePath = join(root, 'revocation.asc');
      await writeFile(revokePath, revocation.slice(revocation.indexOf(':-----BEGIN')).replace(':-----BEGIN', '-----BEGIN'));
      await invokeGpg(recipient.home, ['--import', revokePath]);
      const revokedPath = await exportKey(recipient, 'revoked.asc');
      await rejected({ PublicKeyPath: revokedPath }, 'EVIDENCE_KEY_INVALID');
    });
    completed = true;
  } finally {
    let stopped = true;
    for (const home of homes) {
      try {
        const result = await run(gpgconf, ['--homedir', gpgPath(home), '--kill', 'gpg-agent'], 5000);
        stopped &&= result.status === 0;
      } catch { stopped = false; }
    }
    await appendFile(join(root, 'outcome.private.log'), JSON.stringify({ completed, failed, stopped }));
    assert.equal(stopped, true, 'OPENPGP_TEST_AGENT_STOP_UNVERIFIED');
    if (completed && !failed) await rm(root, { recursive: true });
  }
});
