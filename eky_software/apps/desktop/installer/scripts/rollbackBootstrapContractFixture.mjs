import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const acknowledgement = 'EKY_ROLLBACK_HELPER_STARTED\r\n';

// The enclosing V2 Job owns the deadline and the process tree. This reader
// observes exit and output independently; it never kills or retries a child.
export function readBootstrapExit(child) {
  let stdout = '';
  let stderr = '';
  let exited;
  let outputEnded = false;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (!exited) return;
      if (exited.status !== 0 || exited.signal !== null || stdout === acknowledgement) {
        resolve({ ...exited, stdout, stderr });
      } else if (outputEnded) reject(new Error('ROLLBACK_BOOTSTRAP_ACKNOWLEDGEMENT_INVALID'));
    };
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > 1024) reject(new Error('ROLLBACK_BOOTSTRAP_OUTPUT_INVALID'));
      check();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 1024) reject(new Error('ROLLBACK_BOOTSTRAP_OUTPUT_INVALID'));
    });
    child.stdout.once('end', () => { outputEnded = true; check(); });
    child.once('exit', (status, signal) => { exited = { status, signal }; check(); });
    child.once('error', () => reject(new Error('ROLLBACK_BOOTSTRAP_PROCESS_FAILED')));
  });
}

async function runFixture(inputPath) {
  const input = JSON.parse(await readFile(inputPath, 'utf8'));
  const { root, testCase, runNonce, scenario, artifactDescriptorSha256 } = input;
  assert.ok(['completed', 'missingHelper', 'earlyHelperExit', 'helperHold'].includes(testCase));
  assert.match(runNonce, /^[0-9a-f]{64}$/);
  const phases = [];
  const observe = async (phase) => {
    phases.push(phase);
    await writeFile(join(root, 'handoff-evidence.json'), JSON.stringify({ schemaVersion: 1, phases }));
  };
  const pipeName = 'eky-rollback-contract-' + runNonce;
  const server = createServer();
  let socket;
  const connection = once(server, 'connection').then(([value]) => { socket = value; return value; });
  connection.catch(() => undefined);
  server.listen('\\\\.\\pipe\\' + pipeName);
  await once(server, 'listening');
  let errorCode = null;
  try {
    const progressPath = join(root, 'progress.jsonl');
    await writeFile(progressPath, JSON.stringify({ pipeName, runNonce, testCase }));
    const failed = join(root, 'failed package.msi');
    const rollback = join(root, 'rollback package.msi');
    await writeFile(failed, 'synthetic, never installed');
    await writeFile(rollback, 'synthetic, never installed');
    const child = spawn(join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      fileURLToPath(new URL('../../resources/update/launchRollbackWindowsInstaller.ps1', import.meta.url)),
      '-MsiExecPath', join(process.env.SystemRoot, 'System32', 'msiexec.exe'),
      '-FailedProductCode', '{22222222-2222-4222-8222-222222222222}',
      '-LauncherProcessId', String(process.pid), '-FailedPackagePath', failed, '-RollbackPackagePath', rollback,
      '-RollbackScriptPath', testCase === 'missingHelper' ? join(root, 'absent.ps1')
        : fileURLToPath(new URL('./rollbackBootstrapHelperFixture.ps1', import.meta.url)),
      '-ProgressPath', progressPath,
    ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    const closed = once(child, 'close');
    closed.catch(() => undefined);
    const result = await readBootstrapExit(child);
    await observe('bootstrapExited');
    if (result.status !== 0) {
      assert.equal(result.status, 30);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, '');
      await closed;
      await observe('bootstrapClosed');
      throw new Error('ROLLBACK_BOOTSTRAP_REJECTED');
    }
    assert.equal(result.signal, null);
    assert.equal(result.stdout, acknowledgement);
    assert.equal(result.stderr, '');
    const channel = await connection;
    const lines = createInterface({ input: channel, crlfDelay: Infinity })[Symbol.asyncIterator]();
    const receive = async (expected) => {
      const line = await lines.next();
      if (line.done) throw new Error('ROLLBACK_HELPER_TERMINAL_MISSING');
      assert.equal(line.value, runNonce + ':' + expected);
    };
    await receive('started');
    await observe('helperStarted');
    channel.write('probe\n');
    await receive('alive');
    await observe('helperAliveAfterBootstrapExit');
    if (testCase !== 'helperHold') channel.write('release\n');
    await receive('completed');
    await observe('helperTerminalReceived');
    await closed;
    await observe('bootstrapClosed');
  } catch (error) {
    errorCode = { ROLLBACK_BOOTSTRAP_REJECTED: 'bootstrapRejected',
      ROLLBACK_HELPER_TERMINAL_MISSING: 'helperTerminalMissing',
      ROLLBACK_BOOTSTRAP_ACKNOWLEDGEMENT_INVALID: 'bootstrapAcknowledgementInvalid',
      ROLLBACK_BOOTSTRAP_OUTPUT_INVALID: 'bootstrapOutputInvalid',
      ROLLBACK_BOOTSTRAP_PROCESS_FAILED: 'bootstrapProcessFailed' }[error?.message] ?? 'rollbackContractFailed';
  } finally {
    socket?.destroy();
    server.close();
  }
  await writeFile(join(root, 'worker-result.json'), JSON.stringify({ schemaVersion: 1, runNonce,
    scenario, artifactDescriptorSha256, status: errorCode ? 'failed' : 'completed',
    resultCode: errorCode ? 'rollbackContractFailed' : 'rollbackContractValidated', errorCode }));
  return errorCode ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exitCode = await runFixture(process.argv[2]);
}
