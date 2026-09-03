import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_PATH = resolve(
  TOOL_DIRECTORY,
  'Eky.WindowsProcessSupervisor.csproj',
);
const DOTNET_EXECUTABLE = process.env.EKY_DOTNET_EXE || 'dotnet';
const REQUIRED_SDK_VERSION = '10.0.302';

function runDotnet(arguments_, options = {}) {
  const result = spawnSync(DOTNET_EXECUTABLE, arguments_, {
    cwd: TOOL_DIRECTORY,
    encoding: options.encoding,
    stdio: options.stdio,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_DOTNET_FAILED');
  }
  return result;
}

const versionResult = runDotnet(['--version'], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'ignore'],
});
if (versionResult.stdout.trim() !== REQUIRED_SDK_VERSION) {
  throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_DOTNET_SDK_INVALID');
}

runDotnet(
  [
    'build',
    PROJECT_PATH,
    '--configuration',
    'Release',
    '--nologo',
  ],
  { stdio: 'inherit' },
);
