import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { childEnvironment, exactKeys } from '../../../e2e/experiments/processOwnership/pidNamespaceContract.mjs';
import { guardLinuxService } from '../../../e2e/experiments/processOwnership/linuxServiceContract.mjs';
import { resolveLinuxInspectionElectron } from '../../../e2e/experiments/processOwnership/linuxServiceConfiguration.mjs';

const repository = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/u, '');
const script = fileURLToPath(import.meta.url);
const execute = promisify(execFile);
const maximumOutput = 65_536;
const phases = new Set(['preflight', 'negativeControl', 'restrictionEvidence', 'profileLoad',
  'inspection', 'isolationControl', 'profileCleanup', 'completed']);
let profilePhase = 'preflight';
const profilePhases = new Set(['preflight', 'filePreparation', 'profileLoad', 'profileReadback',
  'cleanupReadback', 'profileUnload', 'fileRemoval']);
const fileCauses = new Set(['ENOENT', 'EACCES', 'EPERM', 'EEXIST', 'ELOOP']);
const profileTokenPattern = /^[a-f0-9]{32}$/u;
const profileCommandMilliseconds = 2000;

export function sandboxProfileCommand(node, entry, mode, token, receipt) {
  assert.ok(['--install-profile', '--remove-profile'].includes(mode));
  assert.match(token, profileTokenPattern);
  return ['-n', '--', '/usr/bin/env', '--ignore-environment',
    ...Object.entries(childEnvironment()).map(([key, value]) => `${key}=${value}`),
    node, entry, mode, token,
    ...(mode === '--remove-profile' ? [String(receipt.dev), String(receipt.ino)] : [])];
}

export function probeCancellation(runtime = process, onCancel = () => {}) {
  const controller = new AbortController();
  const cancel = () => { onCancel(); controller.abort(); };
  runtime.on('SIGINT', cancel);
  runtime.on('SIGTERM', cancel);
  return { signal: controller.signal,
    dispose() { runtime.removeListener('SIGINT', cancel); runtime.removeListener('SIGTERM', cancel); } };
}

export function finishSandboxProbe(report, { phase, failurePhase, cleanup, cancelled }) {
  const terminalPhase = failurePhase ?? (cancelled ? phase : cleanup === 'completed' ? 'completed' : phase);
  assert.ok(phases.has(terminalPhase));
  return { ...report, cleanup, cancelled, phase: terminalPhase,
    status: failurePhase === null && !cancelled && cleanup === 'completed' ? 'passed' : 'failed' };
}

export function safeProfileFailure(error) {
  return { operation: 'linuxSandboxProfile', status: 'failed',
    phase: profilePhases.has(profilePhase) ? profilePhase : 'preflight',
    causeCode: fileCauses.has(error?.code) ? error.code
      : Number.isSafeInteger(error?.code) ? 'commandExitFailed' : 'unverified' };
}

export function parseProfileCreated(text, token) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 512);
  const value = JSON.parse(text);
  assert.ok(exactKeys(value, ['operation', 'status', 'token', 'dev', 'ino']) &&
    value.operation === 'linuxSandboxProfile' && value.status === 'created' && value.token === token &&
    Number.isSafeInteger(value.dev) && value.dev >= 0 && Number.isSafeInteger(value.ino) && value.ino > 0);
  return value;
}

export function readProfileFailure(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 1024) return null;
  const lines = text.trim().split('\n');
  if (lines.length !== 2 || lines[0] !== 'LINUX_SANDBOX_PROBE_FAILED') return null;
  try {
    const value = JSON.parse(lines[1]);
    if (!exactKeys(value, ['operation', 'status', 'phase', 'causeCode']) ||
      value.operation !== 'linuxSandboxProfile' || value.status !== 'failed' || !profilePhases.has(value.phase) ||
      (!fileCauses.has(value.causeCode) && !['commandExitFailed', 'unverified'].includes(value.causeCode))) return null;
    return { operation: value.operation, status: value.status, phase: value.phase, causeCode: value.causeCode };
  } catch { return null; }
}

export function sandboxProbeProfile(electron, token) {
  assert.match(token, profileTokenPattern);
  assert.ok(typeof electron === 'string' && electron.length < 2048 &&
    /^\/[A-Za-z0-9_./@+()-]+$/u.test(electron) && posix.normalize(electron) === electron &&
    /\/node_modules\/\.pnpm\/electron@[0-9]+\.[0-9]+\.[0-9]+\/node_modules\/electron\/dist\/electron$/u.test(electron));
  const name = `eky-k-inspection-${token}`;
  return Object.freeze({ name, path: `/etc/apparmor.d/${name}`,
    bytes: `abi <abi/4.0>,\nprofile ${name} "${electron}" flags=(unconfined) {\n  userns,\n}\n` });
}

export function parseNamespaceProbe(text) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= 512);
  const value = JSON.parse(text);
  assert.ok(exactKeys(value, ['identityVerified', 'pid', 'outcome']) && value.identityVerified === true &&
    Number.isSafeInteger(value.pid) && value.pid > 0 && ['allowed', 'denied', 'restricted', 'unverified'].includes(value.outcome));
  return value;
}

export function confirmsAppArmorRestriction(text, pid) {
  assert.ok(typeof text === 'string' && Buffer.byteLength(text) <= maximumOutput && Number.isSafeInteger(pid) && pid > 0);
  return text.split('\n').some(line => line.includes('operation="userns_create"') &&
    line.includes('profile="unconfined"') && new RegExp(`(?:^|\\s)pid=${pid}(?:\\s|$)`, 'u').test(line) &&
    (line.includes('apparmor="DENIED"') ||
      (line.includes('apparmor="AUDIT"') && line.includes('target="unprivileged_userns"'))));
}

async function command(file, args, timeout = 10_000, signal) {
  return execute(file, args, { cwd: repository, env: childEnvironment(),
    timeout, maxBuffer: maximumOutput, encoding: 'utf8', windowsHide: true, ...(signal ? { signal } : {}) });
}

async function profileLoaded(name) {
  const text = await readFile('/sys/kernel/security/apparmor/profiles', 'utf8');
  assert.ok(Buffer.byteLength(text) <= 1024 * 1024);
  return text.split('\n').includes(`${name} (unconfined)`);
}

function requireRootMode() {
  assert.ok(process.platform === 'linux' && process.getuid() === 0 && process.geteuid() === 0 &&
    process.getgid() === 0 && process.env.CI === 'true' && process.env.GITHUB_ACTIONS === 'true' && process.env.EKY_E2E === '1');
}

async function verifyProfileFile(profile, identity) {
  const info = await lstat(profile.path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.nlink === 1 && info.uid === 0 && info.gid === 0 &&
    (info.mode & 0o7777) === 0o644 && info.size === Buffer.byteLength(profile.bytes));
  if (identity) assert.ok(info.dev === identity.dev && info.ino === identity.ino);
  const handle = await open(profile.path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    assert.ok(opened.dev === info.dev && opened.ino === info.ino && opened.size === info.size);
    assert.equal(await handle.readFile('utf8'), profile.bytes);
    const after = await lstat(profile.path);
    assert.ok(after.dev === info.dev && after.ino === info.ino && after.ctimeMs === info.ctimeMs);
  } finally { await handle.close(); }
  return info;
}

async function mutateProfile(mode, token, receipt) {
  requireRootMode();
  const electron = resolveLinuxInspectionElectron(repository);
  const profile = sandboxProbeProfile(electron, token);
  if (mode === 'install') {
    assert.equal(await profileLoaded(profile.name), false);
    profilePhase = 'filePreparation';
    const handle = await open(profile.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    try { await handle.writeFile(profile.bytes); await handle.sync(); }
    finally { await handle.close(); }
    const identity = await verifyProfileFile(profile);
    assert.ok(Number.isSafeInteger(identity.dev) && Number.isSafeInteger(identity.ino));
    process.stdout.write(JSON.stringify({ operation: 'linuxSandboxProfile', status: 'created',
      token, dev: identity.dev, ino: identity.ino }) + '\n');
    profilePhase = 'profileLoad';
    await command('/usr/sbin/apparmor_parser', ['--skip-cache', '--add', profile.path]);
    profilePhase = 'profileReadback';
    await verifyProfileFile(profile, identity);
    assert.equal(await profileLoaded(profile.name), true);
  } else {
    assert.ok(receipt);
    profilePhase = 'cleanupReadback';
    let identity;
    try { identity = await verifyProfileFile(profile, receipt); }
    catch (error) {
      if (error.code === 'ENOENT' && !await profileLoaded(profile.name)) return;
      throw error;
    }
    if (await profileLoaded(profile.name)) {
      profilePhase = 'profileUnload';
      await command('/usr/sbin/apparmor_parser', ['--skip-cache', '--remove', profile.path]);
    }
    assert.equal(await profileLoaded(profile.name), false);
    await verifyProfileFile(profile, identity);
    profilePhase = 'fileRemoval';
    await unlink(profile.path);
  }
}

export async function runSandboxProbe() {
  const identity = guardLinuxService();
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  const token = randomUUID().replaceAll('-', '');
  const evidence = join(repository, 'apps/e2e/test-results', `run-${randomUUID()}`, 'sandbox-probe');
  await mkdir(evidence, { recursive: true, mode: 0o700 });
  let phase = 'preflight';
  let profileAttempted = false;
  let profileReceipt;
  let failurePhase = null;
  let cleanup = 'notAttempted';
  const cancellation = probeCancellation(process, () => { failurePhase ??= phase; });
  const report = { schemaVersion: 1, operation: 'linuxInspectionSandboxProbe', status: 'failed',
    phase, namespaceRestricted: false, appArmorRestrictionConfirmed: false, negativeControlPreserved: false,
    inspectionPassed: false, globalPolicyPreserved: false, cleanup,
    profileFailure: null, cleanupFailure: null };
  try {
    const originalPolicy = (await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim();
    assert.equal(originalPolicy, '1');
    assert.equal((await readFile('/sys/module/apparmor/parameters/enabled', 'utf8')).trim(), 'Y');
    const electron = resolveLinuxInspectionElectron(repository);
    const binaryBefore = await readFile(electron);
    const binaryHash = createHash('sha256').update(binaryBefore).digest('hex');
    const temporary = await mkdtemp(join(await realpath(tmpdir()), 'eky-linux-sandbox-probe-'));
    const control = join(temporary, 'namespace-probe');
    await command('/usr/bin/g++', ['-std=c++17', '-O2', '-Wall', '-Wextra', '-Werror',
      fileURLToPath(new URL('./linuxSandboxNamespaceProbe.cpp', import.meta.url)), '-o', control], 30_000, cancellation.signal);
    await chmod(control, 0o700);
    const credentials = ['/usr/bin/setpriv', `--reuid=${identity.uid}`, `--regid=${identity.gid}`,
      '--clear-groups', '--no-new-privs', '--bounding-set=-all', '--inh-caps=-all', '--ambient-caps=-all', '--', control];
    const started = Math.floor(Date.now() / 1000);
    phase = 'negativeControl';
    const before = parseNamespaceProbe((await command('/usr/bin/sudo', ['-n', '--', ...credentials],
      10_000, cancellation.signal)).stdout);
    assert.ok(['denied', 'restricted'].includes(before.outcome));
    report.namespaceRestricted = true;
    phase = 'restrictionEvidence';
    const audit = await command('/usr/bin/sudo', ['-n', '--', '/usr/bin/journalctl', '-k', '--no-pager',
      '--output=cat', '-n', '200', `--since=@${started}`], 10_000, cancellation.signal);
    assert.ok(confirmsAppArmorRestriction(audit.stdout, before.pid));
    report.appArmorRestrictionConfirmed = true;
    // The kernel log is classified in memory; no unrelated audit lines are retained.
    phase = 'profileLoad';
    profileAttempted = true;
    try {
      cancellation.signal.throwIfAborted();
      const installed = await command('/usr/bin/sudo', sandboxProfileCommand(process.execPath, script,
        '--install-profile', token), profileCommandMilliseconds);
      profileReceipt = parseProfileCreated(installed.stdout, token);
    } catch (error) {
      try { profileReceipt = parseProfileCreated(error.stdout, token); } catch { /* No receipt grants no cleanup. */ }
      throw error;
    }
    phase = 'inspection';
    const proof = await command(process.execPath,
      [join(repository, 'apps/desktop/scripts/profileInspection/runLinuxProfileInspectionProof.mjs')], 600_000, cancellation.signal);
    const rows = proof.stdout.trim().split('\n').map(line => JSON.parse(line));
    assert.equal(rows.length, 3);
    for (const [index, variant] of ['current', 'schemaChanged', 'missingNative'].entries()) {
      assert.ok(exactKeys(rows[index], ['operation', 'variant', 'status', 'phase', 'processTree']));
      assert.deepEqual(rows[index], { operation: 'linuxProfileInspection', variant,
        status: 'passed', phase: 'hostResult', processTree: 'stopped' });
    }
    report.inspectionPassed = true;
    cancellation.signal.throwIfAborted();
    phase = 'isolationControl';
    const after = parseNamespaceProbe((await command('/usr/bin/sudo', ['-n', '--', ...credentials],
      10_000, cancellation.signal)).stdout);
    assert.equal(after.outcome, before.outcome);
    report.negativeControlPreserved = true;
    assert.equal((await readFile('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8')).trim(), originalPolicy);
    assert.equal(createHash('sha256').update(await readFile(electron)).digest('hex'), binaryHash);
    report.globalPolicyPreserved = true;
  } catch (error) {
    failurePhase ??= phase;
    report.profileFailure = readProfileFailure(error.stderr);
  } finally {
    if (profileAttempted && !profileReceipt) cleanup = 'unverified';
    if (profileReceipt) {
      try {
        phase = 'profileCleanup';
        await command('/usr/bin/sudo', sandboxProfileCommand(process.execPath, script,
          '--remove-profile', token, profileReceipt), profileCommandMilliseconds);
        cleanup = 'completed';
      } catch (error) { cleanup = 'unverified'; report.cleanupFailure = readProfileFailure(error.stderr); }
    }
  }
  const result = finishSandboxProbe(report, { phase, failurePhase, cleanup, cancelled: cancellation.signal.aborted });
  cancellation.dispose();
  await writeFile(join(evidence, 'process-output.private.json'), JSON.stringify(result), { flag: 'wx', mode: 0o600 });
  process.stdout.write(JSON.stringify(result) + '\n');
  return result.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length === 4 && process.argv[2] === '--install-profile') {
      await mutateProfile('install', process.argv[3]);
    } else if (process.argv.length === 6 && process.argv[2] === '--remove-profile') {
      assert.match(process.argv[4], /^(?:0|[1-9][0-9]{0,15})$/u);
      assert.match(process.argv[5], /^[1-9][0-9]{0,15}$/u);
      const receipt = parseProfileCreated(JSON.stringify({ operation: 'linuxSandboxProfile', status: 'created',
        token: process.argv[3], dev: Number(process.argv[4]), ino: Number(process.argv[5]) }), process.argv[3]);
      await mutateProfile('remove', process.argv[3], receipt);
    } else {
      assert.equal(process.argv.length, 2);
      process.exitCode = await runSandboxProbe();
    }
  } catch (error) {
    process.stderr.write('LINUX_SANDBOX_PROBE_FAILED\n');
    if (['--install-profile', '--remove-profile'].includes(process.argv[2])) {
      process.stderr.write(JSON.stringify(safeProfileFailure(error)) + '\n');
    }
    process.exitCode = 1;
  }
}
