import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNativeMsiUpgrade } from '../nativeMsiUpgradeProcess.mjs';

const [requestPath, mode] = process.argv.slice(2);
const request = JSON.parse(await readFile(requestPath, 'utf8'));
const directory = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(directory, '../../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll');
const callbackReturnedPath = resolve(request.workingDirectory, 'native-msi-callback-returned.json');
let closed = false;
let releaseAcknowledgement;
const acknowledgementCase = mode.endsWith('Acknowledgement') || mode.endsWith('AcknowledgementField');
const client = await startNativeMsiUpgrade({
  packagePath: resolve(request.workingDirectory, 'unused.msi'),
  logPath: resolve(request.workingDirectory, 'unused.log'),
  cwd: request.workingDirectory,
  createPipeServer(onConnection) {
    return createServer((socket) => {
      const write = socket.write.bind(socket);
      socket.write = (chunk, ...args) => {
        const value = JSON.parse(chunk);
        assert.equal(value.phase, 'applicationExited');
        if (mode === 'delayedAcknowledgement') {
          releaseAcknowledgement = () => write(chunk, ...args);
          return true;
        }
        if (mode === 'wrongAcknowledgement') value.phase = 'closeRequested';
        if (mode === 'foreignAcknowledgement') value.nonce = (value.nonce[0] === '0' ? '1' : '0') + value.nonce.slice(1);
        if (mode === 'extraAcknowledgementField') value.unexpected = true;
        if (mode === 'duplicateAcknowledgementField')
          return write('{"schemaVersion":1,' + JSON.stringify(value).slice(1) + '\n', ...args);
        if (mode === 'oversizedAcknowledgement') return write('x'.repeat(257), ...args);
        return write(JSON.stringify(value) + '\n', ...args);
      };
      onConnection(socket);
    });
  },
  launch(command, args, options) {
    const input = Buffer.from(JSON.stringify({ mode: acknowledgementCase ? 'valid' : mode,
      pipe: args[6], nonce: args[8], callbackReturnedPath })).toString('base64');
    const child = spawn(command, mode === 'invalidRequest' ? args : [fixture, '--mode', 'nativeMsiContract', '--request', input],
      { ...options, windowsHide: true, stdio: 'ignore' });
    // The enclosing real Job owns this synthetic client. The fixture never kills by PID.
    let launchError;
    child.once('error', (error) => { launchError = error; });
    return { completion: new Promise((yes, no) => child.once('close', (exitCode) => {
      closed = true;
      if (launchError) no(launchError);
      else yes({ exitCode });
    })) };
  },
});
const validation = await client.validation.then(() => 'observed', () => 'rejected');
if (validation === 'observed') {
  if (mode === 'missingAcknowledgement') {
    await writeFile(resolve(request.workingDirectory, 'native-msi-validation.json'),
      JSON.stringify({ observed: true }), { flag: 'wx' });
  } else if (mode === 'disconnectedAcknowledgement') {
    client.abortValidation();
  } else {
    client.acknowledgeApplicationExit();
    if (mode === 'delayedAcknowledgement') {
      assert.equal(typeof releaseAcknowledgement, 'function');
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(closed, false);
      await assert.rejects(readFile(callbackReturnedPath), { code: 'ENOENT' });
      releaseAcknowledgement();
    }
  }
}
const terminal = await client.completion;
await writeFile(resolve(request.workingDirectory, 'native-msi-evidence.json'),
  JSON.stringify({ validation, terminal, clientClosed: closed }), { flag: 'wx' });
await writeFile(resolve(request.workingDirectory, 'worker-result.json'), JSON.stringify({
  schemaVersion: 1, runNonce: request.runNonce, scenario: request.scenario,
  artifactDescriptorSha256: request.artifactDescriptorSha256,
  status: 'completed', resultCode: 'fixtureCompleted', errorCode: null,
}), { flag: 'wx' });
