import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  readInstallerManifest,
  verifyInstallerManifestPackage,
} from '../installerManifest.mjs';
import { preparePackagedUpdateE2eFixture } from './preparePackagedUpdateE2eFixture.mjs';
import {
  createPackagedUpdateScenarioPlan,
  readPackagedUpdateE2eFixture,
  readPackagedUpdateSmokeResult,
} from './packagedUpdateE2eSupport.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const installerDirectory = resolve(scriptDirectory, '..');
const processTimeoutMs = 120_000;
const applicationExitTimeoutMs = 30_000;
const installerStabilityTimeoutMs = 120_000;

export function createWindowsInstallerArguments({
  logPath,
  operation,
  packageOrProductCode,
}) {
  if (
    (operation !== 'install' && operation !== 'uninstall') ||
    typeof packageOrProductCode !== 'string' ||
    packageOrProductCode.length < 1 ||
    typeof logPath !== 'string' ||
    logPath.length < 1
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_INSTALLER_ARGUMENTS_INVALID');
  }
  return Object.freeze([
    operation === 'install' ? '/i' : '/x',
    packageOrProductCode,
    '/qn',
    '/norestart',
    '/l*v',
    logPath,
  ]);
}

export function formatWindowsInstallerProductCode(productCode) {
  if (
    typeof productCode !== 'string' ||
    !/^[0-9A-F]{8}(?:-[0-9A-F]{4}){3}-[0-9A-F]{12}$/i.test(productCode)
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_PRODUCT_CODE_INVALID');
  }
  return `{${productCode.toUpperCase()}}`;
}

export function createPackagedUpdateSmokeInvocation(phase, token) {
  if (
    typeof phase !== 'string' ||
    !/^[a-z][A-Za-z]+$/.test(phase) ||
    typeof token !== 'string' ||
    !/^[0-9a-f]{32}$/.test(token)
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_INVOCATION_INVALID');
  }
  return Object.freeze({
    args: Object.freeze([`--desktop-update-smoke=${phase}`]),
    environment: Object.freeze({ EKY_DESKTOP_UPDATE_SMOKE_TOKEN: token }),
  });
}

export async function runPackagedUpdateE2e() {
  assertWindowsRuntime();
  await assertNoEkyProcess();

  const prepared = await preparePackagedUpdateE2eFixture();
  const fixture = await readPackagedUpdateE2eFixture(prepared.fixturePath);
  const verifiedPackages = await verifyFixturePackages(fixture);
  const sourceInventories = Object.freeze(
    Object.fromEntries(
      await Promise.all(
        Object.entries(verifiedPackages).map(async ([role, packageInfo]) => [
          role,
          await createDirectoryInventory(packageInfo.applicationPath),
        ]),
      ),
    ),
  );
  const evidence = [];

  const fixtureContext = Object.freeze({
    fixture,
    packages: verifiedPackages,
    sourceInventories,
  });
  await cleanupKnownFixtureInstallations(fixtureContext);
  try {
    for (const scenario of createPackagedUpdateScenarioPlan()) {
      evidence.push(
        await runScenario({
          ...fixtureContext,
          name: scenario.name,
        }),
      );
    }
  } finally {
    await cleanupKnownFixtureInstallations(fixtureContext);
  }

  const evidencePath = join(dirname(prepared.fixturePath), 'evidence.json');
  await writeFile(
    evidencePath,
    `${JSON.stringify(
      {
        buildRevision: fixture.buildRevision,
        evidenceFormatVersion: 1,
        packages: Object.fromEntries(
          Object.entries(fixture.packages).map(([role, packageInfo]) => [
            role,
            {
              appVersion: packageInfo.appVersion,
              msiProductVersion: packageInfo.msiProductVersion,
              packageSha256: packageInfo.packageSha256,
              packageSize: packageInfo.packageSize,
            },
          ]),
        ),
        scenarios: evidence,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
  console.log(
    JSON.stringify({
      evidencePath,
      scenarioCount: evidence.length,
      status: 'ok',
    }),
  );
}

async function runScenario(context) {
  const token = randomBytes(16).toString('hex');
  const root = join(tmpdir(), 'eky-desktop-update-smoke', token);
  const scenario = Object.freeze({ ...context, root, token });
  await cleanupKnownFixtureInstallations(context);
  await stageScenarioPackages(scenario);
  try {
    switch (context.name) {
      case 'coordinatedSuccess':
        return await runCoordinatedSuccess(scenario);
      case 'coordinatedCancel':
        return await runCoordinatedCancel(scenario);
      case 'coordinatedRollback':
        return await runCoordinatedRollback(scenario);
      case 'directSetupSuccess':
        return await runDirectSetupSuccess(scenario);
      case 'directSetupFailure':
        return await runDirectSetupFailure(scenario);
      case 'backupForwardRestore':
        return await runBackupForwardRestore(scenario);
      default:
        throw new Error('PACKAGED_UPDATE_E2E_SCENARIO_INVALID');
    }
  } finally {
    await cleanupKnownFixtureInstallations(context);
    await rm(root, { force: true, recursive: true });
  }
}

async function runCoordinatedSuccess(scenario) {
  const seed = await installAndSeedCurrent(scenario);
  const before = await createBusinessInventory(scenario.root);
  const handoff = await runApplicationPhase(scenario, 'prepareSuccess');
  assertResultStatus(handoff, 'handoffReady');
  await installFixturePackage(scenario, 'next', 'coordinated-success-next');
  await assertInstalledPackage(scenario, 'next');
  const result = await runApplicationPhase(scenario, 'verifySuccess');
  assertOkResult(result, {
    appVersion: scenario.packages.next.appVersion,
    journalState: 'accepted',
    pdfSha256: seed.pdfSha256,
  });
  await assertUpdateCacheRotation(scenario);
  await assertBusinessArtifactsRetained(scenario.root, before, result);
  return createScenarioEvidence(scenario.name, result, 'accepted');
}

async function runCoordinatedCancel(scenario) {
  const seed = await installAndSeedCurrent(scenario);
  const before = await createBusinessInventory(scenario.root);
  const handoff = await runApplicationPhase(scenario, 'prepareCancel');
  assertResultStatus(handoff, 'handoffReady');
  const first = await runApplicationPhase(scenario, 'verifyCancel');
  assertOkResult(first, {
    appVersion: scenario.packages.current.appVersion,
    journalState: 'installerNotApplied',
    pdfSha256: seed.pdfSha256,
  });
  const second = await runApplicationPhase(scenario, 'verifyCancel');
  assertOkResult(second, {
    appVersion: scenario.packages.current.appVersion,
    journalState: 'installerNotApplied',
    pdfSha256: seed.pdfSha256,
  });
  await assertInstalledPackage(scenario, 'current');
  await assertInventoriesEqual(
    before,
    await createBusinessInventory(scenario.root),
    'PACKAGED_UPDATE_E2E_CANCEL_PROFILE_CHANGED',
  );
  return createScenarioEvidence(scenario.name, second, 'installerNotApplied');
}

async function runCoordinatedRollback(scenario) {
  const seed = await installAndSeedCurrent(scenario);
  const before = await createBusinessInventory(scenario.root);
  const handoff = await runApplicationPhase(scenario, 'prepareFailure');
  assertResultStatus(handoff, 'handoffReady');
  await installFixturePackage(scenario, 'failure', 'coordinated-failure');
  await assertInstalledPackage(scenario, 'failure');

  let rollbackLaunched = false;
  for (let attempt = 1; attempt <= 6 && !rollbackLaunched; attempt += 1) {
    const result = await runApplicationPhase(
      scenario,
      'verifyRollback',
      true,
    );
    if (result?.status === 'rollbackInstallerLaunched') {
      rollbackLaunched = true;
    } else if (result !== undefined && result.status !== 'failed') {
      throw new Error('PACKAGED_UPDATE_E2E_ROLLBACK_SEQUENCE_INVALID');
    }
  }
  if (!rollbackLaunched) {
    throw new Error('PACKAGED_UPDATE_E2E_ROLLBACK_HANDOFF_MISSING');
  }
  await waitForStableInstalledPackage(scenario, 'current');
  const finalResult = await runApplicationPhase(scenario, 'verifyRollback');
  assertOkResult(finalResult, {
    appVersion: scenario.packages.current.appVersion,
    journalState: 'rolledBack',
    pdfSha256: seed.pdfSha256,
  });
  await assertInventoriesEqual(
    before,
    await createBusinessInventory(scenario.root),
    'PACKAGED_UPDATE_E2E_ROLLBACK_PROFILE_CHANGED',
  );
  return createScenarioEvidence(scenario.name, finalResult, 'rolledBack');
}

async function runDirectSetupSuccess(scenario) {
  const seed = await installAndSeedCurrent(scenario);
  const before = await createBusinessInventory(scenario.root);
  await installFixturePackage(scenario, 'next', 'direct-success-next');
  await assertInstalledPackage(scenario, 'next');
  const result = await runApplicationPhase(scenario, 'verifyDirectSuccess');
  assertOkResult(result, {
    appVersion: scenario.packages.next.appVersion,
    journalState: null,
    pdfSha256: seed.pdfSha256,
  });
  await assertBusinessArtifactsRetained(scenario.root, before, result);
  return createScenarioEvidence(scenario.name, result, 'accepted');
}

async function runDirectSetupFailure(scenario) {
  const seed = await installAndSeedCurrent(scenario);
  const before = await createBusinessInventory(scenario.root);
  await installFixturePackage(scenario, 'failure', 'direct-failure-target');
  await assertInstalledPackage(scenario, 'failure');

  let previousSetupReady = false;
  for (let attempt = 1; attempt <= 6 && !previousSetupReady; attempt += 1) {
    const result = await runApplicationPhase(
      scenario,
      'verifyDirectFailure',
      true,
    );
    if (result?.status === 'previousSetupReady') {
      previousSetupReady = true;
    } else if (result !== undefined && result.status !== 'failed') {
      throw new Error('PACKAGED_UPDATE_E2E_DIRECT_FAILURE_SEQUENCE_INVALID');
    }
  }
  if (!previousSetupReady) {
    throw new Error('PACKAGED_UPDATE_E2E_PREVIOUS_SETUP_NOT_REQUESTED');
  }
  await installFixturePackage(scenario, 'current', 'direct-failure-rollback');
  await assertInstalledPackage(scenario, 'current');
  const finalResult = await runApplicationPhase(
    scenario,
    'verifyDirectFailure',
  );
  assertOkResult(finalResult, {
    appVersion: scenario.packages.current.appVersion,
    journalState: null,
    pdfSha256: seed.pdfSha256,
  });
  await assertDirectRecoveryCleared(scenario.root);
  await assertInventoriesEqual(
    before,
    await createBusinessInventory(scenario.root),
    'PACKAGED_UPDATE_E2E_DIRECT_FAILURE_PROFILE_CHANGED',
  );
  return createScenarioEvidence(scenario.name, finalResult, 'rolledBack');
}

async function runBackupForwardRestore(scenario) {
  const seed = await installAndSeedCurrent(scenario);
  const backupResult = await runApplicationPhase(scenario, 'createBackup');
  assertOkResult(backupResult, {
    appVersion: scenario.packages.current.appVersion,
    journalState: null,
    pdfSha256: seed.pdfSha256,
  });
  await assertRegularFile(join(scenario.root, 'backup', 'source.ekybackup'));

  await installFixturePackage(scenario, 'next', 'backup-forward-next');
  const forwardResult = await runApplicationPhase(
    scenario,
    'verifyDirectSuccess',
  );
  assertOkResult(forwardResult, {
    appVersion: scenario.packages.next.appVersion,
    journalState: null,
    pdfSha256: seed.pdfSha256,
  });
  const restore = await runApplicationPhase(scenario, 'restoreBackup');
  assertResultStatus(restore, 'restoreReady');

  let finalResult;
  for (let attempt = 1; attempt <= 4 && finalResult === undefined; attempt += 1) {
    const result = await runApplicationPhase(scenario, 'verifyBackup', true);
    if (result?.status === 'ok') {
      finalResult = result;
    } else if (result !== undefined && result.status !== 'failed') {
      throw new Error('PACKAGED_UPDATE_E2E_BACKUP_SEQUENCE_INVALID');
    }
  }
  if (finalResult === undefined) {
    throw new Error('PACKAGED_UPDATE_E2E_BACKUP_FORWARD_MISSING');
  }
  assertOkResult(finalResult, {
    appVersion: scenario.packages.next.appVersion,
    journalState: null,
    pdfSha256: seed.pdfSha256,
  });
  if (
    finalResult.migrationChainIdentity !== forwardResult.migrationChainIdentity
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_BACKUP_MIGRATION_CHAIN_INVALID');
  }
  await assertRegularFile(join(scenario.root, 'backup', 'restored.ekybackup'));
  return createScenarioEvidence(scenario.name, finalResult, 'restored');
}

async function installAndSeedCurrent(scenario) {
  await installFixturePackage(scenario, 'current', 'current');
  await assertInstalledPackage(scenario, 'current');
  const result = await runApplicationPhase(scenario, 'seed');
  assertOkResult(result, {
    appVersion: scenario.packages.current.appVersion,
    journalState: null,
  });
  return result;
}

async function stageScenarioPackages(scenario) {
  for (const role of ['current', 'next', 'failure']) {
    const packageInfo = scenario.packages[role];
    const manifest = await readInstallerManifest(packageInfo.manifestPath);
    const targetRoot = join(scenario.root, 'packages', role);
    await mkdir(targetRoot, { recursive: true });
    await Promise.all([
      copyFile(packageInfo.manifestPath, join(targetRoot, 'manifest.json')),
      copyFile(
        packageInfo.msiPath,
        join(targetRoot, manifest.packageFilename),
      ),
    ]);
  }
  await mkdir(join(scenario.root, 'logs'), { recursive: true });
}

async function verifyFixturePackages(fixture) {
  const entries = await Promise.all(
    Object.entries(fixture.packages).map(async ([role, packageInfo]) => {
      const manifest = await readInstallerManifest(packageInfo.manifestPath);
      await verifyInstallerManifestPackage({
        expectedBuildRevision: fixture.buildRevision,
        installerPath: packageInfo.msiPath,
        manifest,
      });
      if (
        manifest.appVersion !== packageInfo.appVersion ||
        manifest.msiProductVersion !== packageInfo.msiProductVersion ||
        manifest.packageSha256 !== packageInfo.packageSha256 ||
        manifest.packageSize !== packageInfo.packageSize
      ) {
        throw new Error('PACKAGED_UPDATE_E2E_PACKAGE_IDENTITY_INVALID');
      }
      return [role, Object.freeze({ ...packageInfo, manifest })];
    }),
  );
  return Object.freeze(Object.fromEntries(entries));
}

async function installFixturePackage(scenario, role, logName) {
  const { msiexecPath } = getWindowsRuntimePaths();
  const packageInfo = scenario.packages[role];
  const exit = await runProcess(
    msiexecPath,
    createWindowsInstallerArguments({
      logPath: join(scenario.root, 'logs', `${logName}.log`),
      operation: 'install',
      packageOrProductCode: packageInfo.msiPath,
    }),
    { timeoutMs: processTimeoutMs },
  );
  if (exit.code !== 0 || exit.signal !== null) {
    throw new Error('PACKAGED_UPDATE_E2E_INSTALL_FAILED');
  }
}

async function cleanupKnownFixtureInstallations(context) {
  const { installRoot, msiexecPath } = getWindowsRuntimePaths();
  await assertNoEkyProcess();
  if (await pathExists(installRoot)) {
    const installedInventory = await createDirectoryInventory(installRoot);
    const isKnownFixture = Object.values(context.sourceInventories).some(
      (inventory) => directoryInventoriesEqual(inventory, installedInventory),
    );
    if (!isKnownFixture) {
      throw new Error('PACKAGED_UPDATE_E2E_UNKNOWN_INSTALL_PRESENT');
    }
  }
  const cleanupRoot = join(tmpdir(), 'eky-desktop-update-smoke-cleanup');
  await mkdir(cleanupRoot, { recursive: true });
  for (const role of ['failure', 'next', 'current']) {
    const packageInfo = context.fixture.packages[role];
    const exit = await runProcess(
      msiexecPath,
      createWindowsInstallerArguments({
        logPath: join(cleanupRoot, `uninstall-${role}.log`),
        operation: 'uninstall',
        packageOrProductCode: formatWindowsInstallerProductCode(
          packageInfo.productCode,
        ),
      }),
      { timeoutMs: processTimeoutMs },
    );
    if (![0, 1605, 1614].includes(exit.code) || exit.signal !== null) {
      throw new Error('PACKAGED_UPDATE_E2E_CLEANUP_FAILED');
    }
  }
  if (await pathExists(installRoot)) {
    throw new Error('PACKAGED_UPDATE_E2E_INSTALL_ROOT_REMAINS');
  }
}

async function runApplicationPhase(scenario, phase, allowNoResult = false) {
  const { executablePath, installRoot } = getWindowsRuntimePaths();
  await assertNoEkyProcess();
  const resultPath = join(
    scenario.root,
    'result',
    'desktop-update-smoke-result.json',
  );
  await rm(resultPath, { force: true });
  const invocation = createPackagedUpdateSmokeInvocation(phase, scenario.token);
  const child = spawn(executablePath, invocation.args, {
    cwd: installRoot,
    env: { ...process.env, ...invocation.environment },
    shell: false,
    stdio: 'ignore',
    windowsHide: true,
  });
  const processState = observeProcess(child);
  const deadline = Date.now() + processTimeoutMs;
  let result;
  while (Date.now() < deadline) {
    result = await tryReadSmokeResult(resultPath, phase);
    if (result !== undefined || processState.exit !== undefined) {
      break;
    }
    await delay(100);
  }
  if (result === undefined && processState.exit === undefined) {
    await terminateProcessTree(child.pid);
    throw new Error('PACKAGED_UPDATE_E2E_APPLICATION_TIMEOUT');
  }
  const exit = await waitForObservedExit(
    processState,
    child.pid,
    applicationExitTimeoutMs,
  );
  result ??= await tryReadSmokeResult(resultPath, phase);
  await waitForNoEkyProcess();
  if (result === undefined) {
    if (allowNoResult && exit.signal === null) {
      return undefined;
    }
    throw new Error('PACKAGED_UPDATE_E2E_APPLICATION_RESULT_MISSING');
  }
  if (
    result.status !== 'failed' &&
    (exit.code !== 0 || exit.signal !== null)
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_APPLICATION_EXIT_INVALID');
  }
  return result;
}

function observeProcess(child) {
  const state = { error: undefined, exit: undefined };
  child.once('error', () => {
    state.error = new Error('PACKAGED_UPDATE_E2E_APPLICATION_START_FAILED');
  });
  child.once('exit', (code, signal) => {
    state.exit = { code: code ?? -1, signal };
  });
  return state;
}

async function waitForObservedExit(state, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (state.exit === undefined && state.error === undefined) {
    if (Date.now() >= deadline) {
      await terminateProcessTree(pid);
      throw new Error('PACKAGED_UPDATE_E2E_APPLICATION_EXIT_TIMEOUT');
    }
    await delay(100);
  }
  if (state.error !== undefined) {
    throw state.error;
  }
  return state.exit;
}

async function tryReadSmokeResult(resultPath, phase) {
  try {
    return await readPackagedUpdateSmokeResult(resultPath, phase);
  } catch (error) {
    if (!(await pathExists(resultPath))) {
      return undefined;
    }
    throw error;
  }
}

async function assertInstalledPackage(scenario, role) {
  const { installRoot } = getWindowsRuntimePaths();
  await assertInventoriesEqual(
    scenario.sourceInventories[role],
    await createDirectoryInventory(installRoot),
    'PACKAGED_UPDATE_E2E_MIXED_INSTALL_ROOT',
  );
}

async function waitForStableInstalledPackage(scenario, role) {
  const deadline = Date.now() + installerStabilityTimeoutMs;
  let stableCount = 0;
  while (Date.now() < deadline) {
    try {
      await assertInstalledPackage(scenario, role);
      stableCount += 1;
      if (stableCount === 2) {
        return;
      }
    } catch {
      stableCount = 0;
    }
    await delay(500);
  }
  throw new Error('PACKAGED_UPDATE_E2E_INSTALLER_STABILITY_TIMEOUT');
}

async function assertUpdateCacheRotation(scenario) {
  const cacheRoot = join(scenario.root, 'user-data', 'update-cache');
  const current = await readCacheMetadata(cacheRoot, 'current');
  const previous = await readCacheMetadata(cacheRoot, 'previous');
  if (
    current.appVersion !== scenario.packages.next.appVersion ||
    current.role !== 'current' ||
    previous.appVersion !== scenario.packages.current.appVersion ||
    previous.role !== 'previous' ||
    (await pathExists(join(cacheRoot, 'candidate')))
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_CACHE_ROTATION_INVALID');
  }
}

async function readCacheMetadata(cacheRoot, role) {
  const value = JSON.parse(
    await readFile(join(cacheRoot, role, 'slot-metadata.json'), 'utf8'),
  );
  if (!isRecord(value) || value.role !== role) {
    throw new Error('PACKAGED_UPDATE_E2E_CACHE_METADATA_INVALID');
  }
  return value;
}

async function assertDirectRecoveryCleared(root) {
  const path = join(
    root,
    'user-data',
    'update-state',
    'direct-setup-migration-recovery-v1.json',
  );
  if (await pathExists(path)) {
    throw new Error('PACKAGED_UPDATE_E2E_DIRECT_RECOVERY_REMAINS');
  }
}

function assertOkResult(result, expected) {
  if (result?.status !== 'ok') {
    throw new Error('PACKAGED_UPDATE_E2E_RESULT_STATUS_INVALID');
  }
  if (result.appVersion !== expected.appVersion) {
    throw new Error('PACKAGED_UPDATE_E2E_RESULT_APP_VERSION_INVALID');
  }
  if (result.acceptedVersion !== expected.appVersion) {
    throw new Error('PACKAGED_UPDATE_E2E_RESULT_ACCEPTED_VERSION_INVALID');
  }
  if (result.journalState !== expected.journalState) {
    throw new Error('PACKAGED_UPDATE_E2E_RESULT_JOURNAL_INVALID');
  }
  if (
    expected.pdfSha256 !== undefined &&
    result.pdfSha256 !== expected.pdfSha256
  ) {
    throw new Error('PACKAGED_UPDATE_E2E_RESULT_PDF_INVALID');
  }
}

function assertResultStatus(result, status) {
  if (result?.status !== status) {
    throw new Error('PACKAGED_UPDATE_E2E_STATUS_EXPECTATION_FAILED');
  }
}

async function assertBusinessArtifactsRetained(root, before, result) {
  const after = await createBusinessInventory(root);
  for (const [path, hash] of before) {
    if ((path.includes('/storage/') || path.includes('/secrets/')) && after.get(path) !== hash) {
      throw new Error('PACKAGED_UPDATE_E2E_BUSINESS_ARTIFACT_CHANGED');
    }
  }
  if (result.artifactCount < 1 || result.secretConfigured !== true) {
    throw new Error('PACKAGED_UPDATE_E2E_BUSINESS_ARTIFACT_MISSING');
  }
}

async function createBusinessInventory(root) {
  const userData = join(root, 'user-data');
  const inventory = new Map();
  for (const relativeRoot of [
    join('runtime', 'data'),
    join('runtime', 'storage'),
    join('runtime', 'secrets'),
  ]) {
    const directory = join(userData, relativeRoot);
    if (!(await pathExists(directory))) {
      continue;
    }
    const nested = await createDirectoryInventory(directory);
    for (const [path, hash] of nested) {
      inventory.set(`${relativeRoot.replaceAll('\\', '/')}/${path}`, hash);
    }
  }
  return inventory;
}

async function createDirectoryInventory(root) {
  const inventory = new Map();
  await addDirectoryInventory(root, root, inventory);
  return inventory;
}

async function addDirectoryInventory(root, directory, inventory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const key = relative(root, path).replaceAll('\\', '/');
    if (entry.isSymbolicLink()) {
      throw new Error('PACKAGED_UPDATE_E2E_SYMLINK_REJECTED');
    }
    if (entry.isDirectory()) {
      await addDirectoryInventory(root, path, inventory);
    } else if (entry.isFile()) {
      inventory.set(key, await hashFile(path));
    } else {
      throw new Error('PACKAGED_UPDATE_E2E_FILE_TYPE_REJECTED');
    }
  }
}

async function assertInventoriesEqual(expected, actual, errorCode) {
  if (!directoryInventoriesEqual(expected, actual)) {
    throw new Error(errorCode);
  }
}

export function directoryInventoriesEqual(expected, actual) {
  if (!(expected instanceof Map) || !(actual instanceof Map)) {
    return false;
  }
  if (expected.size !== actual.size) {
    return false;
  }
  for (const [path, hash] of expected) {
    if (actual.get(path) !== hash) {
      return false;
    }
  }
  return true;
}

async function hashFile(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function assertRegularFile(path) {
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size < 1) {
    throw new Error('PACKAGED_UPDATE_E2E_ARTIFACT_INVALID');
  }
}

async function assertNoEkyProcess() {
  const { tasklistPath } = getWindowsRuntimePaths();
  const output = await runProcessCapture(tasklistPath, [
    '/FI',
    'IMAGENAME eq Eky.exe',
    '/FO',
    'CSV',
    '/NH',
  ]);
  if (output.toLowerCase().includes('"eky.exe"')) {
    throw new Error('PACKAGED_UPDATE_E2E_EKY_PROCESS_RUNNING');
  }
}

async function waitForNoEkyProcess() {
  const deadline = Date.now() + applicationExitTimeoutMs;
  while (Date.now() < deadline) {
    try {
      await assertNoEkyProcess();
      return;
    } catch {
      await delay(100);
    }
  }
  throw new Error('PACKAGED_UPDATE_E2E_EKY_PROCESS_REMAINS');
}

function runProcess(command, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: installerDirectory,
      env: { ...process.env },
      shell: false,
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) {
        void terminateProcessTree(child.pid).finally(() => {
          rejectPromise(new Error('PACKAGED_UPDATE_E2E_PROCESS_TIMEOUT'));
        });
      }
    }, options.timeoutMs);
    child.once('error', () => {
      settled = true;
      clearTimeout(timeout);
      rejectPromise(new Error('PACKAGED_UPDATE_E2E_PROCESS_START_FAILED'));
    });
    child.once('exit', (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolvePromise({ code: code ?? -1, signal });
    });
  });
}

function runProcessCapture(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
    });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.once('error', () => {
      rejectPromise(new Error('PACKAGED_UPDATE_E2E_PROCESS_START_FAILED'));
    });
    child.once('exit', (code, signal) => {
      if (code === 0 && signal === null) {
        resolvePromise(stdout);
      } else {
        rejectPromise(new Error('PACKAGED_UPDATE_E2E_PROCESS_FAILED'));
      }
    });
  });
}

async function terminateProcessTree(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return;
  }
  const { taskkillPath } = getWindowsRuntimePaths();
  await runProcess(taskkillPath, ['/PID', String(pid), '/T', '/F'], {
    timeoutMs: 15_000,
  }).catch(() => undefined);
}

function createScenarioEvidence(name, result, outcome) {
  return Object.freeze({
    acceptedVersion: result.acceptedVersion,
    artifactCount: result.artifactCount,
    migrationChainIdentity: result.migrationChainIdentity,
    name,
    outcome,
    pdfSha256: result.pdfSha256,
    status: 'ok',
  });
}

function requireEnvironmentPath(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length < 3) {
    throw new Error('PACKAGED_UPDATE_E2E_ENVIRONMENT_INVALID');
  }
  return resolve(value);
}

let cachedWindowsRuntimePaths;

function getWindowsRuntimePaths() {
  if (cachedWindowsRuntimePaths !== undefined) {
    return cachedWindowsRuntimePaths;
  }
  assertWindowsRuntime();
  const systemRoot = requireEnvironmentPath('SystemRoot');
  const installRoot = join(
    requireEnvironmentPath('LOCALAPPDATA'),
    'Programs',
    'Eky',
  );
  cachedWindowsRuntimePaths = Object.freeze({
    executablePath: join(installRoot, 'Eky.exe'),
    installRoot,
    msiexecPath: join(systemRoot, 'System32', 'msiexec.exe'),
    taskkillPath: join(systemRoot, 'System32', 'taskkill.exe'),
    tasklistPath: join(systemRoot, 'System32', 'tasklist.exe'),
  });
  return cachedWindowsRuntimePaths;
}

function assertWindowsRuntime() {
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error('PACKAGED_UPDATE_E2E_WINDOWS_X64_REQUIRED');
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length !== 2) {
    throw new Error('PACKAGED_UPDATE_E2E_ARGUMENTS_INVALID');
  }
  await runPackagedUpdateE2e();
}
