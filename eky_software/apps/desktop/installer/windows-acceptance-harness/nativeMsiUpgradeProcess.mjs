import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseStrictJsonObjectBytes } from './strictJsonObject.mjs';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const ADAPTER = resolve(DIRECTORY, '../bin/native-msi-test-adapter/Release/net10.0/Eky.NativeMsiTestAdapter.dll');
const MAX_BYTES = 2048;
const invalid = () => new Error('runningUpgradeValidationInvalid');
const exact = (value, keys) => Object.keys(value).sort().join(',') === keys.sort().join(',');

// The existing worker Job owns this client and every MSI descendant. No new timer or kill path.
export async function startNativeMsiUpgrade({ packagePath, logPath, cwd, launch }) {
  const nonce = randomBytes(32).toString('hex');
  const pipeName = `eky-running-msi-${nonce}`;
  let observed = false, reply = null, channelInvalid = false, connections = 0, bytes = 0;
  let completeValidation, rejectValidation, socketEnded = Promise.resolve();
  const sockets = new Set();
  const validation = new Promise((yes, no) => { completeValidation = yes; rejectValidation = no; });
  validation.catch(() => undefined);
  const fail = () => { channelInvalid = true; rejectValidation(invalid()); };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', fail);
    socket.once('close', () => sockets.delete(socket));
    if (++connections !== 1) { fail(); socket.destroy(); return; }
    socketEnded = new Promise((done) => socket.once('close', done));
    let buffer = Buffer.alloc(0);
    socket.on('data', (part) => {
      try {
        bytes += part.length;
        if (bytes > MAX_BYTES) throw invalid();
        buffer = Buffer.concat([buffer, part]);
        let boundary;
        while ((boundary = buffer.indexOf(10)) >= 0) {
          const value = parseStrictJsonObjectBytes(buffer.subarray(0, boundary),
            { errorCode: 'runningUpgradeValidationInvalid', maximumBytes: MAX_BYTES });
          buffer = buffer.subarray(boundary + 1);
          if (reply !== null || value.schemaVersion !== 1 || value.nonce !== nonce) throw invalid();
          if (value.phase === 'installValidate') {
            if (!exact(value, ['schemaVersion', 'nonce', 'phase']) || observed) throw invalid();
            observed = true;
            completeValidation();
          } else {
            if (!exact(value, ['schemaVersion', 'nonce', 'phase', 'msiExitCode', 'validationObserved', 'callbackValid']) ||
                value.phase !== 'result' || !Number.isInteger(value.msiExitCode) || value.msiExitCode < 0 ||
                value.msiExitCode > 65535 || typeof value.callbackValid !== 'boolean' ||
                value.validationObserved !== observed) throw invalid();
            reply = value;
            if (!observed || !value.callbackValid) rejectValidation(invalid());
          }
        }
      } catch { fail(); socket.destroy(); }
    });
    socket.once('end', () => { if (buffer.length !== 0 || reply === null) fail(); });
  });
  server.on('error', fail);
  const dispose = async () => {
    for (const socket of sockets) socket.destroy();
    if (server.listening) await new Promise((done) => server.close(done));
  };
  try {
    await new Promise((ready, reject) => {
      server.once('error', reject);
      server.listen(`\\\\.\\pipe\\${pipeName}`, () => { server.off('error', reject); ready(); });
    });
    const owned = await launch(process.env.EKY_DOTNET_EXE || 'dotnet',
      [ADAPTER, '--package', packagePath, '--log', logPath, '--pipe', pipeName, '--nonce', nonce], { cwd });
    const completion = (async () => {
      try {
        const host = await owned.completion;
        await socketEnded;
        const protocolValid = !channelInvalid && connections === 1 && reply !== null && reply.msiExitCode === host.exitCode;
        if (!protocolValid || !observed || !reply.callbackValid) rejectValidation(invalid());
        return Object.freeze({ exitCode: protocolValid ? reply.msiExitCode : null,
          protocolValid, validationObserved: observed, callbackValid: protocolValid && reply.callbackValid });
      } catch { fail(); throw invalid(); }
      finally { await dispose(); }
    })();
    completion.catch(() => undefined);
    return Object.freeze({ validation, completion });
  } catch (error) {
    await dispose();
    rejectValidation(invalid());
    throw error;
  }
}
