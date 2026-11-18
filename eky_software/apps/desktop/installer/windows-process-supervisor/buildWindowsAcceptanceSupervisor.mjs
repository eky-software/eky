import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const TOOL_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_PATH = resolve(
  TOOL_DIRECTORY,
  'Eky.WindowsProcessSupervisor.csproj',
);
const PROGRAM_FAILURE_FIXTURE_PROJECT_PATH = resolve(
  TOOL_DIRECTORY,
  'tests',
  'programFailureFixture',
  'Eky.WindowsProcessSupervisor.ContractFixture.csproj',
);
const DOTNET_EXECUTABLE = process.env.EKY_DOTNET_EXE || 'dotnet';
const REQUIRED_SDK_VERSION = '10.0.302';
const JOINT_DIRECTORY = resolve(TOOL_DIRECTORY, 'tests/programFailureFixture/sourceHandoffJoint');
const JOINT_PROJECTION = resolve(TOOL_DIRECTORY, '../obj/source-handoff-joint/source-bootstrap-projection.json');
const APP_DIRECTORY = resolve(TOOL_DIRECTORY, '../../../..');
const INSTALLER_DIRECTORY = resolve(TOOL_DIRECTORY, '..');
const JOINT_OUTPUT = resolve(INSTALLER_DIRECTORY, 'bin/source-handoff-joint');
const JOINT_ASSEMBLY = resolve(JOINT_OUTPUT,
  'Eky.WindowsProcessSupervisor.ContractFixture/Release/net10.0/Eky.WindowsProcessSupervisor.ContractFixture.dll');
const JOINT_BINDING = resolve(JOINT_OUTPUT, 'build-binding.json');
const ADAPTER_PROJECT = resolve(INSTALLER_DIRECTORY,
  'windows-acceptance-harness/native-msi-adapter/Eky.NativeMsiTestAdapter.csproj');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const portable = file => relative(APP_DIRECTORY, file).replaceAll('\\', '/');

function snapshotFiles(files) {
  return [...new Set(files)].sort().map(file => {
    const path = portable(file);
    if (!path || path.startsWith('../') || resolve(APP_DIRECTORY, path) !== resolve(file)) {
      throw new Error('WINDOWS_ACCEPTANCE_SOURCE_INPUT_OUTSIDE_PROJECT');
    }
    const stat = lstatSync(file);
    const canonical = realpathSync.native(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
        (process.platform === 'win32' ? canonical.toLowerCase() !== resolve(file).toLowerCase() : canonical !== resolve(file))) {
      throw new Error('WINDOWS_ACCEPTANCE_SOURCE_INPUT_INVALID');
    }
    return { path, sha256: digest(readFileSync(file)) };
  });
}

function filesBelow(directory) {
  if (!lstatSync(directory, { throwIfNoEntry: false })) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('WINDOWS_ACCEPTANCE_BUILD_LINK_INVALID');
    return entry.isDirectory() ? filesBelow(file) : [file];
  });
}

function ordinaryOutputs() {
  return snapshotFiles(['bin', 'obj'].flatMap(kind =>
    ['windows-process-supervisor', 'windows-process-supervisor-contract-fixture', 'native-msi-test-adapter']
      .flatMap(name => filesBelow(resolve(INSTALLER_DIRECTORY, kind, name)))));
}

function requireSame(actual, expected, code) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(code);
}

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

export async function createSourceBootstrapProjection() {
  const app = resolve(TOOL_DIRECTORY, '../../../..');
  const owners = [
    'apps/desktop/src/main/w6b2PackagedProof.ts',
    'apps/desktop/installer/windows-acceptance-harness/workspaceSuccessRunFixture.mjs',
  ];
  const proof = await import(pathToFileURL(resolve(app, owners[0])).href);
  const fixture = await import(pathToFileURL(resolve(app, owners[1])).href);
  const token = 'a'.repeat(64);
  const temporary = mkdtempSync(join(realpathSync.native(tmpdir()), 'eky source projection '));
  let bootstrap, firstFailure;
  try {
    mkdirSync(join(temporary, proof.W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
      token.slice(0, proof.W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH)), { recursive: true });
    bootstrap = proof.createW6b2PackagedProofBootstrapConfiguration({
      hasProofSwitch: true, tokenValue: token, tempPath: temporary,
    });
    if (!bootstrap.enabled || !bootstrap.root || !bootstrap.userDataPath) {
      throw new Error('WINDOWS_ACCEPTANCE_SOURCE_BOOTSTRAP_PROJECTION_INVALID');
    }
  } catch (error) { firstFailure = error; }
  try { rmSync(temporary, { recursive: true }); }
  catch (error) {
    if (firstFailure) throw new AggregateError([firstFailure, error],
      'WINDOWS_ACCEPTANCE_SOURCE_PROJECTION_AND_CLEANUP_FAILED', { cause: firstFailure });
    throw error;
  }
  if (firstFailure) throw firstFailure;
  return {
    schemaVersion: 1,
    sourceOwners: owners.map(path => ({
      path,
      sha256: createHash('sha256').update(readFileSync(resolve(app, path))).digest('hex'),
    })),
    proofSwitch: proof.W6B2_PACKAGED_PROOF_SWITCH,
    tokenEnvironment: proof.W6B2_PACKAGED_PROOF_TOKEN_ENV,
    markerFilename: proof.W6B2_PACKAGED_PROOF_MARKER_FILE,
    directoryName: proof.W6B2_PACKAGED_PROOF_DIRECTORY_NAME,
    pathTokenLength: proof.W6B2_PACKAGED_PROOF_PATH_TOKEN_LENGTH,
    userDataRelative: relative(bootstrap.root, bootstrap.userDataPath),
    workspaceRunRootPrefix: fixture.WORKSPACE_SUCCESS_RUN_ROOT_PREFIX,
    faultScenarios: [...proof.w6b2PackagedFaultScenarios],
  };
}

export async function prepareSourceHandoffJointBuild(run = runDotnet) {
  rmSync(JOINT_BINDING, { force: true });
  const runtimeInputs = new Set();
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    if (result.url.startsWith('file:')) runtimeInputs.add(fileURLToPath(result.url));
    return result;
  } });
  let projection;
  try {
    // Import-only: the phase's entry guard prevents fixture execution here.
    projection = await createSourceBootstrapProjection();
    await import(pathToFileURL(resolve(JOINT_DIRECTORY, 'sourceHandoffPhase.mjs')).href);
    await import(pathToFileURL(resolve(JOINT_DIRECTORY, 'workspaceSourceMeasurementPhase.mjs')).href);
  } finally { hooks.deregister(); }
  mkdirSync(dirname(JOINT_PROJECTION), { recursive: true });
  writeFileSync(JOINT_PROJECTION, JSON.stringify(projection, null, 2) + '\n');
  const projects = [PROJECT_PATH, PROGRAM_FAILURE_FIXTURE_PROJECT_PATH, ADAPTER_PROJECT];
  const sources = [...runtimeInputs, ...projects, import.meta.filename,
    ...['JointProof.props', 'JointProof.targets', 'syntheticSource.mjs', 'sourceBridgeProtocol.json']
      .map(name => resolve(JOINT_DIRECTORY, name)), JOINT_PROJECTION];
  for (const project of projects) {
    const selected = JSON.parse(run(['msbuild', project, '--nologo', ...jointProperties(),
      '-getItem:Compile,EmbeddedResource'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout);
    for (const kind of ['Compile', 'EmbeddedResource']) {
      for (const item of selected.Items[kind]) sources.push(item.FullPath);
    }
  }
  return { sources: snapshotFiles(sources), ordinary: ordinaryOutputs(), resources: {
    'source-bootstrap-projection.private.json': digest(readFileSync(JOINT_PROJECTION)),
    'bridge-protocol.private.json': digest(readFileSync(resolve(JOINT_DIRECTORY, 'sourceBridgeProtocol.json'))),
  } };
}

function jointProperties() {
  return ['-p:EkyJointReservationProof=true',
    '-p:DirectoryBuildPropsPath=' + resolve(JOINT_DIRECTORY, 'JointProof.props'),
    '-p:CustomAfterMicrosoftCommonTargets=' + resolve(JOINT_DIRECTORY, 'JointProof.targets'),
    '-p:GitRepositoryConfigurationScope=local',
    '-p:UseSharedCompilation=false', '-maxcpucount:1', '-nodeReuse:false'];
}

function verifyJointBuild(prepared, run) {
  const resources = JSON.parse(run([JOINT_ASSEMBLY, '--joint-resource-binding'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout);
  requireSame(resources, prepared.resources, 'WINDOWS_ACCEPTANCE_EMBEDDED_RESOURCES_CHANGED');
  requireSame(snapshotFiles(prepared.sources.map(item => resolve(APP_DIRECTORY, item.path))), prepared.sources,
    'WINDOWS_ACCEPTANCE_SOURCE_CHANGED_DURING_BUILD');
  requireSame(ordinaryOutputs(), prepared.ordinary, 'WINDOWS_ACCEPTANCE_ORDINARY_BUILD_CHANGED');
  const artifacts = snapshotFiles(filesBelow(JOINT_OUTPUT));
  const binding = { schemaVersion: 1, sources: prepared.sources, artifacts, resources };
  writeFileSync(JOINT_BINDING, JSON.stringify(binding) + '\n', { flag: 'wx' });
}

export function assertSourceHandoffBuildBinding(binding) {
  if (binding.schemaVersion !== 1 || !Array.isArray(binding.sources) || !binding.sources.length ||
      !Array.isArray(binding.artifacts) || !binding.artifacts.length) {
    throw new Error('WINDOWS_ACCEPTANCE_SOURCE_BUILD_BINDING_INVALID');
  }
  for (const name of ['sources', 'artifacts']) {
    requireSame(snapshotFiles(binding[name].map(item => resolve(APP_DIRECTORY, item.path))), binding[name],
      'WINDOWS_ACCEPTANCE_SOURCE_BUILD_BINDING_CHANGED');
  }
}

export function verifySourceHandoffBuildBinding() {
  assertSourceHandoffBuildBinding(JSON.parse(readFileSync(JOINT_BINDING, 'utf8')));
}

export async function buildWindowsAcceptanceSupervisor(
  arguments_ = process.argv.slice(2),
  { run = runDotnet, prepareJoint = prepareSourceHandoffJointBuild, verifyJoint = verifyJointBuild } = {},
) {
  const joint = arguments_.length === 1 && arguments_[0] === '--source-handoff-joint';
  if (arguments_.length !== 0 && !joint) {
    throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_BUILD_SELECTION_INVALID');
  }
  const versionResult = run(['--version'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (versionResult.stdout.trim() !== REQUIRED_SDK_VERSION) {
    throw new Error('WINDOWS_ACCEPTANCE_SUPERVISOR_DOTNET_SDK_INVALID');
  }
  for (const project of [PROJECT_PATH, PROGRAM_FAILURE_FIXTURE_PROJECT_PATH]) {
    run(['build', project, '--configuration', 'Release', '--nologo'], { stdio: 'inherit' });
  }
  if (joint) {
    const prepared = await prepareJoint(run);
    run(['build', PROGRAM_FAILURE_FIXTURE_PROJECT_PATH, '--configuration', 'Release', '--nologo',
      ...jointProperties()], { stdio: 'inherit' });
    verifyJoint(prepared, run);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildWindowsAcceptanceSupervisor();
}
