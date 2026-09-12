import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startNativeMsiUpgrade } from '../nativeMsiUpgradeProcess.mjs';

const [requestPath, mode] = process.argv.slice(2);
const request = JSON.parse(await readFile(requestPath, 'utf8'));
const directory = dirname(fileURLToPath(import.meta.url));
const fixture = resolve(directory, '../../bin/windows-process-supervisor-contract-fixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll');
let closed = false;
const client = await startNativeMsiUpgrade({
  packagePath: resolve(request.workingDirectory, 'unused.msi'),
  logPath: resolve(request.workingDirectory, 'unused.log'),
  cwd: request.workingDirectory,
  launch(command, args, options) {
    const input = Buffer.from(JSON.stringify({ mode, pipe: args[6], nonce: args[8] })).toString('base64');
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
const terminal = await client.completion;
await writeFile(resolve(request.workingDirectory, 'native-msi-evidence.json'),
  JSON.stringify({ validation, terminal, clientClosed: closed }), { flag: 'wx' });
await writeFile(resolve(request.workingDirectory, 'worker-result.json'), JSON.stringify({
  schemaVersion: 1, runNonce: request.runNonce, scenario: request.scenario,
  artifactDescriptorSha256: request.artifactDescriptorSha256,
  status: 'completed', resultCode: 'fixtureCompleted', errorCode: null,
}), { flag: 'wx' });
