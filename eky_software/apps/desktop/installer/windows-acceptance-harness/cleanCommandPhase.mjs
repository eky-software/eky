import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseCleanCallerArguments, validateCleanCallerResult } from './cleanCallerResult.mjs';
import { cleanCallerResultFile } from './cleanCallerResultFile.mjs';
import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { materializeLocalImmutableFixture, verifyLocalImmutableSourceFixture } from './localImmutableInstallerFixture.mjs';
import { verifyWindowsAcceptanceArtifact } from './verifyWindowsAcceptanceArtifact.mjs';
import { createInstallerProductCode } from '../installerIdentity.mjs';
import { readInstallerManifest } from '../installerManifest.mjs';
import { createCleanInstallUninstallWorkerRequest, createWorkerTerminalResult, readCleanInstallUninstallWorkerRequest,
    readCleanInstallUninstallResult, cleanResultPathForRequest, writeJsonAtomicExclusive } from './cleanInstallUninstallContracts.mjs';
import { runCleanInstallUninstallWorker } from './runCleanInstallUninstallWorker.mjs';
import { prepareCleanInstallUninstallTerminalOutcome, completeCleanInstallUninstallTerminalOutcome,
  cleanInstallUninstallFailureDetails, CLEAN_COMMAND_ERROR_CODES } from './cleanInstallUninstallFailureBoundary.mjs';
import { executeProductOperation } from './installerProductOperationWorker.mjs';
import { acceptanceSingleProduct, validateAcceptanceProductFacts } from './acceptanceProductFacts.mjs';
import { readAcceptanceCommandPhase, readCommandPhaseJson as readJson, hasExactPhaseKeys as exact } from './acceptanceCommandPhaseInput.mjs';
import budgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const invalid = () => { throw new Error('WINDOWS_ACCEPTANCE_CLEAN_ARGUMENTS_INVALID'); };
const safeCode = (error) => CLEAN_COMMAND_ERROR_CODES.includes(error?.message)
  ? error.message : 'WINDOWS_ACCEPTANCE_CLEAN_UNEXPECTED_FAILURE';
const STATE_KEYS = ['runRoot', 'artifact', 'profileBefore', 'profileAfter', 'products',
  'safetyErrorCode', 'fixtureRemoved', 'fixtureCleanupResultCode'];

export function readCleanCommandPhase(path) {
  return readAcceptanceCommandPhase(path, { commandKind: 'clean', phases: budgets.cleanCommand.phases.map(([name]) => name),
    parseArguments: parseCleanCallerArguments,
    createState: () => ({ runRoot: null, artifact: null, profileBefore: null, profileAfter: null, products: {},
      safetyErrorCode: null, fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' }),
    async validateState(state, input) {
      if (!exact(state, STATE_KEYS) || typeof state.fixtureRemoved !== 'boolean') invalid();
      validateAcceptanceProductFacts(state.products, input.history);
      if (state.runRoot !== null && (dirname(state.runRoot) !== await realpath(tmpdir()) ||
        !/^eky-windows-acceptance-v2-clean-[a-zA-Z0-9]{6}$/.test(basename(state.runRoot)) ||
        (state.artifact && (state.artifact.fixtureRoot !== resolve(state.runRoot, 'fixture') ||
          state.artifact.sourceDescriptorPath !== input.commandArguments[1] ||
          state.artifact.artifactDescriptorSha256 !== input.commandArguments[3] ||
          state.artifact.buildRevision !== input.commandArguments[5])))) invalid();
    } });
}

async function terminalPlan(context) {
  const { state, reports } = context;
  const path = resolve(state.runRoot, 'scenario', 'worker-request.json');
  const request = await readCleanInstallUninstallWorkerRequest(path);
  if (!reports.scenario || request.runNonce !== reports.scenario.runNonce) invalid();
  return prepareCleanInstallUninstallTerminalOutcome({ supervisorResult: reports.scenario,
    readScenarioResult: () => readCleanInstallUninstallResult(cleanResultPathForRequest(path), request),
    verifyExactProductState: () => acceptanceSingleProduct(state.products, 'After') });
}

async function terminalOutcome(context) {
  const plan = await terminalPlan(context);
  const cleanup = context.state.products.uninstallSource;
  try { return { terminal: completeCleanInstallUninstallTerminalOutcome(plan, {
    cleanup: cleanup?.status === 'completed' && cleanup.resultCleanup === 'completed'
      ? { status: 'completed', resultCode: 'semanticCleanupCompleted' }
      : { status: 'failed', errorCode: 'semanticCleanupFailed' },
    postcondition: acceptanceSingleProduct(context.state.products, 'Final') }), failure: null }; }
  catch (error) { const failure = cleanInstallUninstallFailureDetails(error); if (!failure) throw error; return { terminal: null, failure }; }
}

async function runProduct(context, dependencies) {
  const { phase, state, binding, phaseRoot } = context;
  const uninstall = phase === 'uninstallSource';
  if (uninstall && (await terminalPlan(context)).cleanupAction !== 'cleanupThenVerify') return;
  const verified = await (dependencies.verifyProductArtifact ?? verifyWindowsAcceptanceArtifact)({
    artifactRoot: state.artifact.fixtureRoot, expectedDescriptorSha256: binding.artifactDescriptorSha256,
    expectedBuildRevision: context.commandArguments[5] });
  const manifest = await (dependencies.readManifest ?? readInstallerManifest)(verified.manifestPath);
  state.products[phase] = await (dependencies.executeProduct ?? executeProductOperation)({ schemaVersion: 1,
    nonce: binding.runNonce, operation: uninstall ? 'uninstall' : 'inspect',
    productCode: `{${createInstallerProductCode(manifest.msiProductVersion)}}`, scenarioRoot: phaseRoot,
    nodeExecutable: process.execPath, workerPath: resolve(DIRECTORY, 'installerProductOperationWorker.mjs'),
    timeoutMilliseconds: uninstall ? 125000 : 35000, cleanupReserveMilliseconds: 5000, deliveryReserveMilliseconds: 1000 });
}

export async function executeCleanCommandPhase(context, dependencies = {}) {
  const { phase, state, binding, resultPath, descriptorPath } = context;
  const inventory = dependencies.inventoryProfile ?? createClosedDirectoryInventory;
  if (phase === 'prepare') {
    if (!process.env.APPDATA) throw new Error('WINDOWS_ACCEPTANCE_CLEAN_ENVIRONMENT_INVALID');
    await cleanCallerResultFile('prepare', resultPath, context.callerBinding);
    let temporary;
    try { temporary = await realpath(tmpdir());
      const info = await lstat(temporary);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
    } catch { throw new Error('WINDOWS_ACCEPTANCE_CLEAN_TEMP_ROOT_INVALID'); }
    state.runRoot = await mkdtemp(resolve(temporary, 'eky-windows-acceptance-v2-clean-'));
  } else if (phase === 'inventoryBefore') state.profileBefore = await inventory(resolve(process.env.APPDATA, 'Eky'));
  else if (phase === 'materialize') {
    state.artifact = await (dependencies.materializeFixture ?? materializeLocalImmutableFixture)(descriptorPath, state.runRoot);
    if (state.artifact.artifactDescriptorSha256 !== binding.artifactDescriptorSha256 ||
      state.artifact.buildRevision !== context.commandArguments[5]) throw new Error('WINDOWS_ACCEPTANCE_CLEAN_ARTIFACT_VERIFICATION_FAILED');
  } else if (phase.startsWith('inspect') || phase === 'uninstallSource') {
    await runProduct(context, dependencies);
    if (state.products[phase]?.status === 'failed') {
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'), { binding,
        errorCode: phase === 'uninstallSource' ? 'WINDOWS_ACCEPTANCE_CLEAN_FINAL_CLEANUP_FAILED' : 'WINDOWS_ACCEPTANCE_CLEAN_STATE_INSPECTION_FAILED' });
      return 1;
    }
  } else if (phase === 'scenarioPreparation') {
    if (acceptanceSingleProduct(state.products, 'Before').resultCode !== 'exactProductAbsent')
      throw new Error('WINDOWS_ACCEPTANCE_CLEAN_PRECONDITION_FAILED');
    await mkdir(resolve(state.runRoot, 'scenario'));
  } else if (phase === 'scenario') {
    const request = createCleanInstallUninstallWorkerRequest({ runNonce: binding.runNonce,
      artifactDescriptorSha256: binding.artifactDescriptorSha256, fixtureRoot: state.artifact.fixtureRoot });
    const path = resolve(state.runRoot, 'scenario', 'worker-request.json');
    await writeJsonAtomicExclusive(path, request);
    return (dependencies.runScenario ?? runCleanInstallUninstallWorker)(['--request', path]);
  } else if (phase === 'semantic') await terminalPlan(context);
  else if (phase === 'artifact') {
    try { await (dependencies.verifyArtifact ?? verifyLocalImmutableSourceFixture)(state.artifact); }
    catch { state.safetyErrorCode ??= 'WINDOWS_ACCEPTANCE_LOCAL_FIXTURE_CHANGED'; }
  } else if (phase === 'inventoryAfter') {
    try {
      state.profileAfter = await inventory(resolve(process.env.APPDATA, 'Eky'));
      if (!inventoriesMatch(state.profileBefore, state.profileAfter)) throw new Error();
    } catch { state.safetyErrorCode ??= 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED'; }
  } else if (phase === 'fixtureCleanup') {
    const outcome = await commandOutcome(context);
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'terminal.json'), { binding, outcome });
    if (outcome.processTreeAbsent === true && state.safetyErrorCode === null &&
      ['exactProductAbsent', 'exactProductAbsentAfterCleanup'].includes(outcome.productStateVerificationResultCode) &&
      ['notRequired', 'semanticCleanupCompleted'].includes(outcome.semanticCleanupResultCode)) {
      await (dependencies.removeRunRoot ?? ((root) => rm(root, { recursive: true })))(state.runRoot);
      await lstat(state.runRoot).then(invalid, (error) => { if (error.code !== 'ENOENT') throw error; });
      state.fixtureRemoved = true;
      state.fixtureCleanupResultCode = 'fixtureRemoved';
    }
  } else if (phase === 'publish' || phase === 'publishFailure') return publish(context);
  else invalid();
  return 0;
}

async function commandOutcome(context) {
  const { state, reports } = context;
  const { terminal, failure } = await terminalOutcome(context);
  const final = acceptanceSingleProduct(state.products, 'Final');
  const common = { schemaVersion: 1, scenario: 'cleanInstallUninstall', processTreeAbsent: reports.scenario.processTreeAbsent,
    productProcessAbsent: true, safetyErrorCode: state.safetyErrorCode, fixtureRemoved: false,
    fixtureCleanupResultCode: 'retainedUnverified', supervisorProcessResultCode: reports.scenario.processResultCode,
    supervisorWorkerResultCode: reports.scenario.workerResultCode, supervisorCleanupResultCode: reports.scenario.cleanupResultCode };
  if (failure || state.safetyErrorCode || final.resultCode !== 'exactProductAbsent') return { ...common, ...failure,
    status: 'failed', errorCode: failure?.errorCode ?? state.safetyErrorCode ?? 'WINDOWS_ACCEPTANCE_CLEAN_UNINSTALLED_STATE_INVALID' };
  return { ...common, status: 'completed', resultCode: 'cleanInstallUninstallCompleted',
    appVersion: state.artifact.manifest.appVersion, packageSha256: state.artifact.packageSha256,
    businessDataPreserved: terminal.profilePreserved, installedStateValidated: terminal.installedStateValidated,
    uninstalledStateValidated: terminal.uninstalledStateValidated, repairValidated: terminal.repairValidated,
    reinstallValidated: terminal.reinstallValidated, payloadValidated: terminal.payloadValidated,
    installExitCode: terminal.installExitCode, uninstallExitCode: terminal.uninstallExitCode,
    scenarioResultCode: terminal.resultCode, semanticCleanupResultCode: 'notRequired',
    productStateVerificationResultCode: final.resultCode,
    profileFileCountBefore: state.profileBefore.filter((item) => item.kind === 'file').length,
    profileFileCountAfter: state.profileAfter.filter((item) => item.kind === 'file').length };
}

async function publish(context) {
  const { state, reports, history, phase, callerBinding } = context;
  let outcome;
  if (phase === 'publishFailure') {
    const first = history.find((item) => item.exitCode !== 0);
    let errorCode = !first || reports[first.phase]?.processResultCode === 'deadlineExceeded'
      ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED' : 'WINDOWS_ACCEPTANCE_CLEAN_UNEXPECTED_FAILURE';
    let failure;
    if (reports.scenario) {
      try { failure = (await terminalOutcome(context)).failure; } catch { /* Preserve the original process failure. */ }
    }
    if (first?.phase === 'scenario' && failure) errorCode = failure.errorCode;
    else if (first) {
      try {
        const error = await readJson(resolve(context.commandRoot, first.phase, 'phase-error.json'));
        if (exact(error, ['binding', 'errorCode']) && error.binding.runNonce === first.runNonce &&
          error.binding.artifactDescriptorSha256 === callerBinding.artifactDescriptorSha256 && CLEAN_COMMAND_ERROR_CODES.includes(error.errorCode))
          errorCode = error.errorCode;
      } catch { /* Optional classification does not replace process evidence. */ }
    }
    outcome = { ...failure, schemaVersion: 1, scenario: 'cleanInstallUninstall', status: 'failed', errorCode,
      processTreeAbsent: reports.scenario?.processTreeAbsent === true, productProcessAbsent: true,
      fixtureRemoved: false, fixtureCleanupResultCode: history.some((item) => item.phase === 'fixtureCleanup' && item.exitCode !== 0)
        ? 'fixtureCleanupFailed' : 'retainedUnverified' };
  } else {
    const saved = await readJson(resolve(context.commandRoot, 'fixtureCleanup', 'terminal.json'));
    const item = history.find((entry) => entry.phase === 'fixtureCleanup');
    if (!exact(saved, ['binding', 'outcome']) || !exact(saved.binding, Object.keys(context.binding)) ||
      saved.binding.runNonce !== item.runNonce || saved.binding.schemaVersion !== 1 ||
      saved.binding.scenario !== 'acceptanceCommandPhase' || saved.binding.artifactDescriptorSha256 !== callerBinding.artifactDescriptorSha256) invalid();
    if (state.fixtureRemoved) await lstat(state.runRoot).then(invalid, (error) => { if (error.code !== 'ENOENT') throw error; });
    outcome = { ...saved.outcome, fixtureRemoved: state.fixtureRemoved, fixtureCleanupResultCode: state.fixtureCleanupResultCode };
  }
  await cleanCallerResultFile('publish', context.resultPath, validateCleanCallerResult({ binding: callerBinding, outcome }, callerBinding));
  return outcome.status === 'completed' ? 0 : 1;
}

export async function runCleanCommandPhase(args, dependencies = {}) {
  let context;
  try {
    if (args.length !== 2 || args[0] !== '--phase-request') invalid();
    context = await readCleanCommandPhase(args[1]);
    const code = await executeCleanCommandPhase(context, dependencies);
    if (context.phase !== 'scenario') await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-state.json'),
      { binding: context.binding, state: context.state });
    if (context.phase === 'scenario' && code === 0) {
      const path = resolve(context.state.runRoot, 'scenario', 'worker-request.json');
      const request = await readCleanInstallUninstallWorkerRequest(path);
      const result = await readCleanInstallUninstallResult(cleanResultPathForRequest(path), request);
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'worker-result.json'), createWorkerTerminalResult(request, result));
    } else await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'worker-result.json'), { ...context.binding,
      status: code === 0 ? 'completed' : 'failed', resultCode: code === 0 ? 'phaseCompleted' : 'phaseFailed', errorCode: code === 0 ? null : 'phaseFailed' });
    return code;
  } catch (error) {
    if (context) {
      try { await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'), { binding: context.binding, errorCode: safeCode(error) }); }
      catch { /* Keep required result failure; no synchronous diagnostic fallback. */ }
    }
    return 1;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = await runCleanCommandPhase(process.argv.slice(2));
