import { spawn } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runBoundedWindowsAdapterProcess } from './boundedWindowsAdapterProcess.mjs';
import { LEGACY_FILESYSTEM_ERROR_CODES, LEGACY_FILESYSTEM_MESSAGE_MAX_BYTES, validateLegacyFilesystemRequest } from './legacyUpgradeFilesystem.mjs';
import { LEGACY_FILESYSTEM_TIMEOUT_MS, LEGACY_FILESYSTEM_TERMINATION_MS } from './legacyUpgradeBudget.mjs';

const ADAPTER = fileURLToPath(new URL('./legacyUpgradeFilesystem.mjs', import.meta.url));
export class LegacyFilesystemFailure extends Error {
  constructor(code) { super(code); }
}

export function createLegacyUpgradeFilesystemRuntime({ runProcess = runBoundedWindowsAdapterProcess,
  spawnProcess = spawn } = {}) {
  let firstFailure = null;
  let processAbsent = true;
  async function invoke(operation, payload) {
    if (!processAbsent) throw new LegacyFilesystemFailure('WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_PROCESS_REMAINS');
    const request = validateLegacyFilesystemRequest({ schemaVersion: 1, operation, payload });
    let reply;
    let messages = 0;
    let channelFailed = false;
    let result;
    try { result = await runProcess({ command: process.execPath, arguments: [ADAPTER], cwd: dirname(ADAPTER),
      timeoutMilliseconds: LEGACY_FILESYSTEM_TIMEOUT_MS[operation], terminationTimeoutMilliseconds: LEGACY_FILESYSTEM_TERMINATION_MS,
      spawnProcess(command, args, options) {
        const child = spawnProcess(command, args, { ...options, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
        child.on('message', (value) => { messages++; reply = value; });
        child.once('spawn', () => {
          try { child.send(request, (error) => { if (error) channelFailed = true; }); }
          catch { channelFailed = true; }
        });
        return child;
      },
    }); } catch {
      // A thrown adapter call is not evidence that no child was created.
      result = { directProcessAbsent: false };
    }
    processAbsent = result?.directProcessAbsent === true;
    const keys = reply && Object.keys(reply).sort().join(',');
    const valid = !channelFailed && messages === 1 && reply?.schemaVersion === 1 && reply.operation === operation &&
      Buffer.byteLength(JSON.stringify(reply)) <= LEGACY_FILESYSTEM_MESSAGE_MAX_BYTES;
    if (processAbsent && result.status === 'completed' && result.exitCode === 0 && valid && reply.status === 'completed' &&
      keys === 'operation,schemaVersion,status,value') return reply.value;
    const code = !processAbsent ? 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_PROCESS_REMAINS'
      : result.resultCode === 'timedOut' ? 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_TIMED_OUT'
        : result.status === 'completed' && result.exitCode === 1 && valid && reply.status === 'failed' &&
          keys === 'errorCode,operation,schemaVersion,status' && LEGACY_FILESYSTEM_ERROR_CODES.includes(reply.errorCode) ? reply.errorCode
        : 'WINDOWS_ACCEPTANCE_LEGACY_FILESYSTEM_FAILED';
    firstFailure ??= { operation, resultCode: code };
    throw new LegacyFilesystemFailure(code);
  }
  return Object.freeze({
    inventoryProfile: (root) => invoke('inventory', { root }),
    materializeFixture: (descriptorPath, fixtureRoot) => invoke('materialize', { descriptorPath, fixtureRoot }),
    verifySemanticPostcondition: (payload) => invoke('semantic', payload),
    verifyArtifact: (artifact) => invoke('artifact', { artifact }),
    removeRunRoot: (root) => invoke('remove', { root }),
    outcome: () => ({ filesystemProcessAbsent: processAbsent,
      filesystemOperation: firstFailure?.operation ?? 'notFailed',
      filesystemErrorCode: firstFailure?.resultCode ?? null }),
  });
}
