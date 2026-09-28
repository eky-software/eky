import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const nativeDirectory = 'apps/e2e/experiments/processOwnership/adapterNative';
const artifactDirectory = 'apps/e2e/.artifacts/t3c-adapter';
const assembly = 'Eky.ProcessOwnershipAdapter';
const linkedSources = [
  'NativeMethods.cs', 'WindowsJob.cs', 'WindowsCommandLine.cs', 'SupervisorContracts.cs',
].map(name => `apps/desktop/installer/windows-process-supervisor/${name}`);
const buildInputs = [
  'apps/e2e/scripts/windowsBackendOwnerBuild.mjs',
  'apps/e2e/scripts/prepare-windows-backend-owner.mjs',
];
const outputNames = ['.exe', '.dll', '.deps.json', '.runtimeconfig.json'].map(suffix => assembly + suffix);
const buildFailure = 'E2E_BACKEND_OWNER_BUILD_REQUIRED';
const hash = value => createHash('sha256').update(value).digest('hex');

export function windowsBackendOwnerBuildPaths(repositoryRoot) {
  const artifacts = resolve(repositoryRoot, artifactDirectory);
  const output = join(artifacts, 'bin', assembly, 'release_win-x64');
  return Object.freeze({
    artifacts, output, executable: join(output, `${assembly}.exe`),
    marker: join(artifacts, 'backend-owner-build.json'),
    project: resolve(repositoryRoot, nativeDirectory, `${assembly}.csproj`),
  });
}

function sourceIdentity(repositoryRoot) {
  const files = [];
  const visit = directory => {
    for (const entry of readdirSync(resolve(repositoryRoot, directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error(buildFailure);
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && /\.(?:cs|csproj|props|targets|Config)$/u.test(entry.name)) files.push(path);
    }
  };
  visit(nativeDirectory);
  return hash(JSON.stringify([...files, ...linkedSources, ...buildInputs].sort().map(path =>
    [path, hash(readFileSync(resolve(repositoryRoot, path)))])));
}

function outputIdentity(output) {
  return hash(JSON.stringify(outputNames.map(name => [name, hash(readFileSync(join(output, name)))])));
}

export function assertWindowsBackendOwnerBuild(repositoryRoot) {
  try {
    const paths = windowsBackendOwnerBuildPaths(repositoryRoot);
    const marker = JSON.parse(readFileSync(paths.marker, 'utf8'));
    if (marker === null || Array.isArray(marker) ||
      Object.keys(marker).sort().join(',') !== 'outputIdentity,schemaVersion,sourceIdentity' ||
      marker.schemaVersion !== 1 || marker.sourceIdentity !== sourceIdentity(repositoryRoot) ||
      marker.outputIdentity !== outputIdentity(paths.output)) throw new Error(buildFailure);
    return paths.executable;
  } catch { throw new Error(buildFailure); }
}

export function prepareWindowsBackendOwner(input, dependencies = {}) {
  const platform = dependencies.platform ?? process.platform;
  // The Windows prerequisite is not a Linux containment implementation.
  if (platform !== 'win32') return 'notApplicable';
  const run = dependencies.run ?? spawnSync;
  const environment = input.environment ?? process.env;
  const paths = windowsBackendOwnerBuildPaths(input.repositoryRoot);
  // A failed build must not leave an earlier success marker or output usable.
  rmSync(paths.marker, { force: true });
  rmSync(paths.output, { recursive: true, force: true });
  rmSync(join(paths.artifacts, 'obj', assembly), { recursive: true, force: true });
  mkdirSync(paths.artifacts, { recursive: true });
  const before = sourceIdentity(input.repositoryRoot);
  const dotnet = environment.EKY_DOTNET_EXE ?? 'dotnet';
  const execute = (command, args, timeout, env = environment) => {
    const result = run(command, args, {
      cwd: input.repositoryRoot, env, shell: false, windowsHide: true,
      stdio: 'inherit', timeout,
    });
    if (result.error !== undefined || result.status !== 0 || result.signal !== null) {
      throw new Error('E2E_BACKEND_OWNER_PREPARATION_FAILED');
    }
  };
  execute(dotnet, ['build', paths.project, '--configuration', 'Release', '--nologo'], 300_000);
  const selfTestEnvironment = { ...environment, EKY_E2E: '1' };
  execute(dotnet, [join(paths.output, `${assembly}.dll`), '--self-test'], 60_000, selfTestEnvironment);
  execute(dotnet, [join(paths.output, `${assembly}.dll`), '--backend-self-test'], 60_000, selfTestEnvironment);
  execute(dotnet, [join(paths.output, `${assembly}.dll`), '--vite-service-self-test'], 60_000, selfTestEnvironment);
  execute(dotnet, [join(paths.output, `${assembly}.dll`), '--electron-service-self-test'], 60_000, selfTestEnvironment);
  execute(dotnet, [join(paths.output, `${assembly}.dll`), '--chromium-service-self-test'], 60_000, selfTestEnvironment);
  // The real owner requires pipe handles, including when preparation runs in a terminal.
  const resume = run(dotnet, [join(paths.output, `${assembly}.dll`), '--resume-failure-self-test', realpathSync(process.execPath)], {
    cwd: input.repositoryRoot, env: selfTestEnvironment, shell: false, windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 4096, timeout: 60_000,
  });
  let proof;
  try { proof = JSON.parse(resume.stdout); } catch { /* Missing or non-protocol output is rejected below. */ }
  const validProof = proof !== null && typeof proof === 'object' && !Array.isArray(proof) &&
    Object.keys(proof).sort().join(',') === 'checks,kind,passed,schemaVersion,stage' &&
    proof.schemaVersion === 1 && proof.kind === 'resumeFailureSelfTest' && typeof proof.passed === 'boolean' &&
    ['guard', 'preparation', 'launch', 'resume', 'terminal', 'ownerClosed', 'complete'].includes(proof.stage) &&
    Number.isSafeInteger(proof.checks) && proof.checks >= 0 && proof.checks <= 25;
  if (validProof) (dependencies.writeResumeProof ?? (value => console.log(JSON.stringify(value))))(proof);
  if (resume.error !== undefined || resume.status !== 0 || resume.signal !== null || resume.stderr !== '' ||
    !validProof || !proof.passed || proof.stage !== 'complete' || proof.checks !== 25) {
    throw new Error('E2E_BACKEND_OWNER_PREPARATION_FAILED');
  }
  if (sourceIdentity(input.repositoryRoot) !== before) throw new Error('E2E_BACKEND_OWNER_SOURCE_CHANGED');
  writeFileSync(paths.marker, JSON.stringify({
    schemaVersion: 1, sourceIdentity: before, outputIdentity: outputIdentity(paths.output),
  }), { flag: 'wx', mode: 0o600 });
  assertWindowsBackendOwnerBuild(input.repositoryRoot);
  return 'prepared';
}
