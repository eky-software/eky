import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIRECTORY = dirname(fileURLToPath(import.meta.url));

export function readCompilationContext(requestPath, request) {
  if (
    request.schemaVersion !== 1 || request.scenario !== 'jobObjectFeasibility' ||
    !/^[0-9a-f]{64}$/.test(request.runNonce) ||
    !/^[0-9a-f]{64}$/.test(request.artifactDescriptorSha256) ||
    !isAbsolute(requestPath) || !isAbsolute(request.workingDirectory) ||
    dirname(requestPath) !== request.workingDirectory
  ) throw new Error('fixtureCompilationRequestInvalid');
  return {
    schemaVersion: 1, scenario: request.scenario, runNonce: request.runNonce,
    artifactDescriptorSha256: request.artifactDescriptorSha256,
    runRoot: resolve(request.workingDirectory, request.runNonce),
    workerResultPath: resolve(request.workingDirectory, 'worker-result.json'),
  };
}

// Preparation has its own invocation of the existing Job supervisor, not a direct-child timer.
export async function executeFixtureCompilation(context, compiler) {
  await mkdir(context.runRoot, { recursive: true });
  const command = compiler ?? {
    executable: resolve(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe'),
    arguments: [
      '/nologo', '/target:winexe', '/reference:System.Windows.Forms.dll',
      '/reference:System.Drawing.dll', '/out:' + resolve(context.runRoot, 'WindowContract.exe'),
      resolve(DIRECTORY, '..', 'WindowsApplicationCloseRequest.cs'),
      resolve(DIRECTORY, 'WindowsApplicationCloseFixture.cs'),
    ],
  };
  const succeeded = await new Promise((done) => {
    const child = spawn(command.executable, command.arguments, {
      cwd: context.runRoot, stdio: 'ignore', windowsHide: true,
    });
    child.once('error', () => done(false));
    child.once('close', (code) => done(code === 0));
  });
  await writeFile(context.workerResultPath, JSON.stringify({
    schemaVersion: 1, scenario: context.scenario, runNonce: context.runNonce,
    artifactDescriptorSha256: context.artifactDescriptorSha256,
    status: succeeded ? 'completed' : 'failed',
    resultCode: succeeded ? 'fixtureCompiled' : 'fixtureCompilationFailed',
    errorCode: succeeded ? null : 'fixtureCompilerFailed',
  }), { flag: 'wx' });
  return succeeded ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || basename(process.argv[2]) !== 'request.json') {
      throw new Error('fixtureCompilationRequestInvalid');
    }
    const requestPath = resolve(process.argv[2]);
    const context = readCompilationContext(requestPath, JSON.parse(await readFile(requestPath, 'utf8')));
    process.exitCode = await executeFixtureCompilation(context);
  } catch { process.exitCode = 1; }
}
