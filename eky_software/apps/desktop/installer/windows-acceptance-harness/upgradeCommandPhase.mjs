import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseUpgradeCallerArguments, validateUpgradeCallerResult } from './upgradeCallerResult.mjs';
import { upgradeCallerResultFile } from './upgradeCallerResultFile.mjs';
import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { materializeUpgradeRollbackArtifactFixture, verifyUpgradeRollbackArtifactSourceFixture } from './upgradeRollbackArtifactFixture.mjs';
import { verifyUpgradeRollbackArtifact } from './upgradeRollbackArtifact.mjs';
import { createUpgradeRollbackWorkerRequest, createUpgradeRollbackWorkerTerminalResult, readUpgradeRollbackWorkerRequest,
  readUpgradeRollbackResult, upgradeRollbackResultPathForRequest, writeJsonAtomicExclusive } from './upgradeRollbackContracts.mjs';
import { runUpgradeRollbackWorker } from './runUpgradeRollbackWorker.mjs';
import { prepareUpgradeRollbackTerminalOutcome, completeUpgradeRollbackTerminalOutcome,
  upgradeRollbackFailureDetails, UPGRADE_COMMAND_ERROR_CODES } from './upgradeRollbackFailureBoundary.mjs';
import { executeProductOperation } from './installerProductOperationWorker.mjs';
import { acceptanceProductPair, acceptanceProductCleanup, validateAcceptanceProductFacts } from './acceptanceProductFacts.mjs';
import { readAcceptanceCommandPhase, readCommandPhaseJson as readJson, hasExactPhaseKeys as exact } from './acceptanceCommandPhaseInput.mjs';
import budgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const invalid = () => { throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARGUMENTS_INVALID'); };
const safeCode = (error) => UPGRADE_COMMAND_ERROR_CODES.includes(error?.message)
  ? error.message : 'WINDOWS_ACCEPTANCE_UPGRADE_UNEXPECTED_FAILURE';
const STATE_KEYS = ['runRoot', 'artifact', 'profileBefore', 'profileAfter', 'products',
  'safetyErrorCode', 'fixtureRemoved', 'fixtureCleanupResultCode'];

export function readUpgradeCommandPhase(path) {
  return readAcceptanceCommandPhase(path, { commandKind: 'upgrade', phases: budgets.upgradeCommand.phases.map(([name]) => name),
    parseArguments: parseUpgradeCallerArguments,
    createState: () => ({ runRoot: null, artifact: null, profileBefore: null, profileAfter: null, products: {},
      safetyErrorCode: null, fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' }),
    async validateState(state, input) {
      if (!exact(state, STATE_KEYS) || typeof state.fixtureRemoved !== 'boolean') invalid();
      validateAcceptanceProductFacts(state.products, input.history);
      if (state.runRoot !== null && (dirname(state.runRoot) !== await realpath(tmpdir()) ||
        !/^eky-windows-acceptance-v2-upgrade-[a-zA-Z0-9]{6}$/.test(basename(state.runRoot)) ||
        (state.artifact && (state.artifact.artifactRoot !== resolve(state.runRoot, 'fixture') ||
          state.artifact.sourceArtifactRoot !== dirname(input.commandArguments[1]) ||
          state.artifact.descriptorSha256 !== input.commandArguments[3] ||
          state.artifact.buildRevision !== input.commandArguments[5])))) invalid();
    } });
}

async function terminalPlan(context) {
  const { state, reports } = context;
  const path = resolve(state.runRoot, 'scenario', 'worker-request.json');
  const request = await readUpgradeRollbackWorkerRequest(path);
  if (!reports.scenario || request.runNonce !== reports.scenario.runNonce) invalid();
  return prepareUpgradeRollbackTerminalOutcome({ supervisorResult: reports.scenario,
    readScenarioResult: () => readUpgradeRollbackResult(upgradeRollbackResultPathForRequest(path), request),
    verifyExactProductStates: () => acceptanceProductPair(state.products, 'After') });
}

async function terminalOutcome(context) {
  const plan = await terminalPlan(context);
  try { return { terminal: completeUpgradeRollbackTerminalOutcome(plan, {
    cleanup: acceptanceProductCleanup(context.state.products),
    postcondition: acceptanceProductPair(context.state.products, 'Final') }), failure: null }; }
  catch (error) { const failure = upgradeRollbackFailureDetails(error); if (!failure) throw error; return { terminal: null, failure }; }
}

async function runProduct(context, dependencies) {
  const { phase, state, binding, phaseRoot } = context;
  const uninstall = phase.startsWith('uninstall');
  if ((uninstall || phase.endsWith('Cleanup')) && (await terminalPlan(context)).cleanupAction !== 'cleanupThenVerify') return;
  const role = phase.includes('Source') ? 'source' : 'target';
  if (uninstall) {
    const before = acceptanceProductPair(state.products, 'Cleanup');
    if (before.status !== 'completed') throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_STATE_INSPECTION_FAILED');
    if (!before[`${role}Present`]) return;
  }
  const verified = await (dependencies.verifyProductArtifact ?? verifyUpgradeRollbackArtifact)({
    artifactRoot: state.artifact.artifactRoot, expectedDescriptorSha256: binding.artifactDescriptorSha256,
    expectedBuildRevision: context.commandArguments[5] });
  state.products[phase] = await (dependencies.executeProduct ?? executeProductOperation)({ schemaVersion: 1,
    nonce: binding.runNonce, operation: uninstall ? 'uninstall' : 'inspect',
    productCode: `{${verified.roles[role].productCode}}`, scenarioRoot: phaseRoot,
    nodeExecutable: process.execPath, workerPath: resolve(DIRECTORY, 'installerProductOperationWorker.mjs'),
    timeoutMilliseconds: uninstall ? 125000 : 35000, cleanupReserveMilliseconds: 5000, deliveryReserveMilliseconds: 1000 });
}

export async function executeUpgradeCommandPhase(context, dependencies = {}) {
  const { phase, state, binding, resultPath, descriptorPath } = context;
  const inventory = dependencies.inventoryProfile ?? createClosedDirectoryInventory;
  if (phase === 'prepare') {
    if (!process.env.APPDATA) throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ENVIRONMENT_INVALID');
    await upgradeCallerResultFile('prepare', resultPath, context.callerBinding);
    let temporary;
    try { temporary = await realpath(tmpdir());
      const info = await lstat(temporary);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error();
    } catch { throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_TEMP_ROOT_INVALID'); }
    state.runRoot = await mkdtemp(resolve(temporary, 'eky-windows-acceptance-v2-upgrade-'));
  } else if (phase === 'inventoryBefore') state.profileBefore = await inventory(resolve(process.env.APPDATA, 'Eky'));
  else if (phase === 'materialize') {
    state.artifact = await (dependencies.materializeFixture ?? materializeUpgradeRollbackArtifactFixture)(descriptorPath, resolve(state.runRoot, 'fixture'));
    if (state.artifact.descriptorSha256 !== binding.artifactDescriptorSha256 ||
      state.artifact.buildRevision !== context.commandArguments[5]) throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_ARTIFACT_VERIFICATION_FAILED');
  } else if (phase.startsWith('inspect') || phase.startsWith('uninstall')) {
    await runProduct(context, dependencies);
    if (state.products[phase]?.status === 'failed') {
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'), { binding,
        errorCode: phase.startsWith('uninstall') ? 'WINDOWS_ACCEPTANCE_UPGRADE_FINAL_CLEANUP_FAILED' : 'WINDOWS_ACCEPTANCE_UPGRADE_STATE_INSPECTION_FAILED' });
      return 1;
    }
  } else if (phase === 'scenarioPreparation') {
    if (acceptanceProductPair(state.products, 'Before').resultCode !== 'exactProductsAbsent')
      throw new Error('WINDOWS_ACCEPTANCE_UPGRADE_PRECONDITION_FAILED');
    await mkdir(resolve(state.runRoot, 'scenario'));
  } else if (phase === 'scenario') {
    const request = createUpgradeRollbackWorkerRequest({ runNonce: binding.runNonce,
      artifactDescriptorSha256: binding.artifactDescriptorSha256, fixtureRoot: state.artifact.artifactRoot });
    const path = resolve(state.runRoot, 'scenario', 'worker-request.json');
    await writeJsonAtomicExclusive(path, request);
    return (dependencies.runScenario ?? runUpgradeRollbackWorker)(['--request', path]);
  } else if (phase === 'semantic') await terminalPlan(context);
  else if (phase === 'artifact') {
    try { await (dependencies.verifyArtifact ?? verifyUpgradeRollbackArtifactSourceFixture)(state.artifact); }
    catch { state.safetyErrorCode ??= 'WINDOWS_ACCEPTANCE_UPGRADE_LOCAL_FIXTURE_CHANGED'; }
  } else if (phase === 'inventoryAfter') {
    try {
      state.profileAfter = await inventory(resolve(process.env.APPDATA, 'Eky'));
      if (!inventoriesMatch(state.profileBefore, state.profileAfter)) throw new Error();
    } catch { state.safetyErrorCode ??= 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED'; }
  } else if (phase === 'fixtureCleanup') {
    const outcome = await commandOutcome(context);
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'terminal.json'), { binding, outcome });
    if (outcome.processTreeAbsent === true && state.safetyErrorCode === null && outcome.applicationCleanupResultCode !== 'cleanupUnverified' &&
      ['exactProductsAbsent', 'exactProductsAbsentAfterCleanup'].includes(outcome.postconditionResultCode) &&
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
  const final = acceptanceProductPair(state.products, 'Final');
  const common = { schemaVersion: 1, scenario: 'upgradeRollback', processTreeAbsent: reports.scenario.processTreeAbsent,
    productProcessAbsent: true, safetyErrorCode: state.safetyErrorCode, fixtureRemoved: false,
    fixtureCleanupResultCode: 'retainedUnverified', supervisorProcessResultCode: reports.scenario.processResultCode,
    supervisorWorkerResultCode: reports.scenario.workerResultCode, supervisorCleanupResultCode: reports.scenario.cleanupResultCode };
  if (failure || state.safetyErrorCode || final.resultCode !== 'exactProductsAbsent') return { ...common, ...failure,
    status: 'failed', errorCode: failure?.errorCode ?? state.safetyErrorCode ?? 'WINDOWS_ACCEPTANCE_UPGRADE_FINAL_STATE_INVALID' };
  return { ...common, status: 'completed', resultCode: 'upgradeRollbackCompleted',
    sourceVersion: state.artifact.roles.source.appVersion, targetVersion: state.artifact.roles.target.appVersion,
    sourcePackageSha256: state.artifact.roles.source.packageSha256, targetPackageSha256: state.artifact.roles.target.packageSha256,
    windowsRollbackPackageSha256: state.artifact.roles.windowsRollback.packageSha256,
    businessDataPreserved: true, scenarioProof: terminal, upgradeExitCode: terminal.upgradeExitCode,
    runningUpgradeInitialExitCode: terminal.runningUpgradeInitialExitCode, runningUpgradeObservation: terminal.runningUpgradeObservation,
    applicationCleanupResultCode: terminal.applicationCleanupResultCode, scenarioResultCode: terminal.resultCode,
    semanticCleanupResultCode: 'notRequired', initialProductStateResultCode: 'exactProductsAbsent', postconditionResultCode: final.resultCode,
    profileFileCountBefore: state.profileBefore.filter((item) => item.kind === 'file').length,
    profileFileCountAfter: state.profileAfter.filter((item) => item.kind === 'file').length };
}

async function publish(context) {
  const { state, reports, history, phase, callerBinding } = context;
  let outcome;
  if (phase === 'publishFailure') {
    const first = history.find((item) => item.exitCode !== 0);
    let errorCode = !first || reports[first.phase]?.processResultCode === 'deadlineExceeded'
      ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED' : 'WINDOWS_ACCEPTANCE_UPGRADE_UNEXPECTED_FAILURE';
    let failure;
    if (reports.scenario) {
      try { failure = (await terminalOutcome(context)).failure; } catch { /* Preserve the original process failure. */ }
    }
    if (first?.phase === 'scenario' && failure) errorCode = failure.errorCode;
    else if (first) {
      try {
        const error = await readJson(resolve(context.commandRoot, first.phase, 'phase-error.json'));
        if (exact(error, ['binding', 'errorCode']) && error.binding.runNonce === first.runNonce &&
          error.binding.artifactDescriptorSha256 === callerBinding.artifactDescriptorSha256 && UPGRADE_COMMAND_ERROR_CODES.includes(error.errorCode))
          errorCode = error.errorCode;
      } catch { /* Optional classification does not replace process evidence. */ }
    }
    outcome = { ...failure, schemaVersion: 1, scenario: 'upgradeRollback', status: 'failed', errorCode,
      processTreeAbsent: reports.scenario?.processTreeAbsent === true, productProcessAbsent: true,
      safetyErrorCode: state.safetyErrorCode, fixtureRemoved: false,
      fixtureCleanupResultCode: history.some((item) => item.phase === 'fixtureCleanup' && item.exitCode !== 0)
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
  await upgradeCallerResultFile('publish', context.resultPath, validateUpgradeCallerResult({ binding: callerBinding, outcome }, callerBinding));
  return outcome.status === 'completed' ? 0 : 1;
}

export async function runUpgradeCommandPhase(args, dependencies = {}) {
  let context;
  try {
    if (args.length !== 2 || args[0] !== '--phase-request') invalid();
    context = await readUpgradeCommandPhase(args[1]);
    const code = await executeUpgradeCommandPhase(context, dependencies);
    if (context.phase !== 'scenario') await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-state.json'),
      { binding: context.binding, state: context.state });
    if (context.phase === 'scenario' && code === 0) {
      const path = resolve(context.state.runRoot, 'scenario', 'worker-request.json');
      const request = await readUpgradeRollbackWorkerRequest(path);
      const result = await readUpgradeRollbackResult(upgradeRollbackResultPathForRequest(path), request);
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'worker-result.json'), createUpgradeRollbackWorkerTerminalResult(request, result));
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
  process.exitCode = await runUpgradeCommandPhase(process.argv.slice(2));
