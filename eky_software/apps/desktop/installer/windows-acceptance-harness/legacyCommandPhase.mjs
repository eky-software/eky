import { lstat, mkdir, mkdtemp, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseLegacyCallerArguments, validateLegacyCallerResult } from './legacyCallerResult.mjs';
import { legacyCallerResultFile } from './legacyCallerResultFile.mjs';
import { parseLegacyUpgradeArguments, requireLegacyUpgradeProductPrecondition,
  resolveLegacyUpgradeTemporaryRoot } from './legacyUpgradeAdmission.mjs';
import { executeLegacyFilesystem } from './legacyUpgradeFilesystem.mjs';
import { verifyLegacyUpgradeArtifact } from './legacyUpgradeArtifact.mjs';
import { createLegacyUpgradeWorkerRequest, readLegacyUpgradeWorkerRequest, readLegacyUpgradeResult,
  legacyUpgradeResultPathForRequest, writeJsonAtomicExclusive } from './legacyUpgradeContracts.mjs';
import { runLegacyUpgradeWorker } from './runLegacyUpgradeWorker.mjs';
import { executeProductOperation } from './installerProductOperationWorker.mjs';
import { acceptanceProductPair, validateAcceptanceProductFacts } from './acceptanceProductFacts.mjs';
import { prepareLegacyUpgradeTerminalOutcome, completeLegacyUpgradeTerminalOutcome,
  LEGACY_COMMAND_ERROR_CODES, legacyUpgradeFailureDetails } from './legacyUpgradeFailureBoundary.mjs';
import { inventoriesMatch } from './closedDirectoryInventory.mjs';
import { readAcceptanceCommandPhase, readCommandPhaseJson as readJson, hasExactPhaseKeys as exact } from './acceptanceCommandPhaseInput.mjs';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PHASES = commandBudgets.legacyCommand.phases.map(([name]) => name);
const STATE_KEYS = ['runRoot', 'artifact', 'profileBefore', 'profileAfter', 'products', 'semanticProof',
  'safetyErrorCode', 'fixtureRemoved', 'fixtureCleanupResultCode'];
const invalid = () => { throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARGUMENTS_INVALID'); };
const safeCode = (error) => LEGACY_COMMAND_ERROR_CODES.includes(error?.message)
  ? error.message : 'WINDOWS_ACCEPTANCE_LEGACY_UNEXPECTED_FAILURE';

export function readLegacyCommandPhase(inputPath) {
  return readAcceptanceCommandPhase(inputPath, {
    commandKind: 'legacy', phases: PHASES,
    parseArguments: (args) => parseLegacyCallerArguments(args, parseLegacyUpgradeArguments),
    createState: () => ({ runRoot: null, artifact: null, profileBefore: null, profileAfter: null, products: {},
      semanticProof: null, safetyErrorCode: null, fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' }),
    async validateState(state, input) {
      if (!exact(state, STATE_KEYS) || !state.products || Array.isArray(state.products) ||
        typeof state.fixtureRemoved !== 'boolean') invalid();
      validateAcceptanceProductFacts(state.products, input.history);
      if (state.runRoot !== null && (dirname(state.runRoot) !== await realpath(tmpdir()) ||
        !/^eky-windows-acceptance-v2-legacy-[a-zA-Z0-9]{6}$/.test(basename(state.runRoot)) ||
        (state.artifact && (state.artifact.artifactRoot !== resolve(state.runRoot, 'fixture') ||
          state.artifact.sourceArtifactRoot !== dirname(input.commandArguments[1]) ||
          state.artifact.descriptorSha256 !== input.commandArguments[3] ||
          state.artifact.buildRevision !== input.commandArguments[5])))) invalid();
    },
  });
}
const productPair = (state, suffix) => acceptanceProductPair(state.products, suffix);

async function terminalPlan(context, verifySemanticPostcondition = () => context.state.semanticProof) {
  const { state, reports } = context;
  const workerPath = resolve(state.runRoot, 'scenario', 'worker-request.json');
  const request = await readLegacyUpgradeWorkerRequest(workerPath);
  const supervisorResult = reports.scenario;
  if (!supervisorResult || request.runNonce !== supervisorResult.runNonce) invalid();
  return prepareLegacyUpgradeTerminalOutcome({ productPrecondition: productPair(state, 'Before'), supervisorResult,
    readScenarioResult: () => readLegacyUpgradeResult(legacyUpgradeResultPathForRequest(workerPath), request),
    verifyExactProductStates: () => productPair(state, 'After'), verifySemanticPostcondition });
}

async function terminalOutcome(context) {
  const plan = await terminalPlan(context);
  const state = context.state;
  const cleanupState = productPair(state, 'Cleanup');
  let cleanup = cleanupState;
  if (cleanupState.status === 'completed') {
    cleanup = ['Target', 'Source'].some((role) => cleanupState[`${role.toLowerCase()}Present`] &&
      state.products[`uninstall${role}`]?.status !== 'completed')
      ? { status: 'failed', errorCode: 'semanticCleanupFailed' }
      : { status: 'completed', resultCode: 'semanticCleanupCompleted' };
  }
  try { return { terminal: completeLegacyUpgradeTerminalOutcome(plan, { cleanup, postcondition: productPair(state, 'Final') }), failure: null }; }
  catch (error) { const failure = legacyUpgradeFailureDetails(error); if (!failure) throw error; return { terminal: null, failure }; }
}

async function runProduct(context, { executeProduct = executeProductOperation, verifyProductArtifact = verifyLegacyUpgradeArtifact } = {}) {
  const { state, phase, phaseRoot } = context;
  const uninstall = phase.startsWith('uninstall');
  const role = phase.includes('Source') ? 'source' : 'target';
  if (phase.endsWith('Cleanup') || uninstall) {
    const plan = await terminalPlan(context);
    if (plan.cleanupAction !== 'cleanupThenVerify') return;
    if (uninstall) {
      const inspected = productPair(state, 'Cleanup');
      if (inspected.status !== 'completed') throw new Error('WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED');
      if (!inspected[`${role}Present`]) return;
    }
  }
  // Revalidate artifact identity at the mutation boundary, never trust a
  // serialized ProductCode or a previous cleanup-allowed flag.
  const artifact = await verifyProductArtifact({ artifactRoot: state.artifact.artifactRoot,
    expectedDescriptorSha256: context.binding.artifactDescriptorSha256, expectedBuildRevision: context.commandArguments[5] });
  state.products[phase] = await executeProduct({ schemaVersion: 1,
    nonce: context.binding.runNonce, operation: uninstall ? 'uninstall' : 'inspect',
    productCode: `{${artifact[role].productCode}}`, scenarioRoot: phaseRoot,
    nodeExecutable: process.execPath, workerPath: resolve(DIRECTORY, 'installerProductOperationWorker.mjs'),
    timeoutMilliseconds: uninstall ? 125000 : 35000, cleanupReserveMilliseconds: 5000, deliveryReserveMilliseconds: 1000 });
}

export async function executeLegacyCommandPhase(context, dependencies = {}) {
  const { phase, state, binding, resultPath, commandArguments, reports } = context;
  const filesystem = (operation, payload) => (dependencies.filesystem ?? executeLegacyFilesystem)({ schemaVersion: 1, operation, payload });
  if (phase === 'prepare') {
    await legacyCallerResultFile('prepare', resultPath, parseLegacyCallerArguments(commandArguments, parseLegacyUpgradeArguments).binding);
    state.runRoot = await mkdtemp(resolve(await resolveLegacyUpgradeTemporaryRoot(), 'eky-windows-acceptance-v2-legacy-'));
  } else if (phase === 'inventoryBefore') state.profileBefore = await filesystem('inventory', { root: resolve(process.env.APPDATA, 'Eky') });
  else if (phase === 'materialize') {
    state.artifact = await filesystem('materialize', { descriptorPath: commandArguments[1], fixtureRoot: resolve(state.runRoot, 'fixture') });
    if (state.artifact.descriptorSha256 !== binding.artifactDescriptorSha256 || state.artifact.buildRevision !== commandArguments[5])
      throw new Error('WINDOWS_ACCEPTANCE_LEGACY_ARTIFACT_VERIFICATION_FAILED');
  } else if (phase.startsWith('inspect') || phase.startsWith('uninstall')) {
    await runProduct(context, dependencies);
    if (state.products[phase]?.status === 'failed') {
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'), { binding: context.binding,
        errorCode: phase.startsWith('uninstall') ? 'WINDOWS_ACCEPTANCE_LEGACY_FINAL_CLEANUP_FAILED'
          : 'WINDOWS_ACCEPTANCE_LEGACY_STATE_INSPECTION_FAILED' });
      return 1;
    }
  }
  else if (phase === 'scenarioPreparation') {
    requireLegacyUpgradeProductPrecondition(productPair(state, 'Before'));
    await mkdir(resolve(state.runRoot, 'scenario'));
  } else if (phase === 'scenario') {
    const request = createLegacyUpgradeWorkerRequest({ runNonce: binding.runNonce,
      artifactDescriptorSha256: binding.artifactDescriptorSha256, fixtureRoot: state.artifact.artifactRoot });
    const path = resolve(state.runRoot, 'scenario', 'worker-request.json');
    await writeJsonAtomicExclusive(path, request);
    return (dependencies.runScenario ?? runLegacyUpgradeWorker)(['--request', path]);
  } else if (phase === 'semantic') {
    await terminalPlan(context, async () => {
      try {
        state.semanticProof = await filesystem('semantic', { artifact: state.artifact,
          runNonce: reports.scenario.runNonce, runtimeRoot: state.runRoot });
      } catch { state.semanticProof = { status: 'failed', errorCode: 'legacySemanticProofFailed' }; }
      return state.semanticProof;
    });
  } else if (phase === 'artifact') {
    try { await filesystem('artifact', { artifact: state.artifact }); }
    catch { state.safetyErrorCode ??= 'WINDOWS_ACCEPTANCE_LEGACY_LOCAL_FIXTURE_CHANGED'; }
  } else if (phase === 'inventoryAfter') {
    try {
      state.profileAfter = await filesystem('inventory', { root: resolve(process.env.APPDATA, 'Eky') });
      if (!inventoriesMatch(state.profileBefore, state.profileAfter)) throw new Error();
    } catch { state.safetyErrorCode ??= 'WINDOWS_ACCEPTANCE_NORMAL_PROFILE_CHANGED'; }
  } else if (phase === 'fixtureCleanup') {
    const { terminal, failure } = await terminalOutcome(context);
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'terminal.json'),
      { binding: context.binding, outcome: commandOutcome(context, terminal, failure) });
    const cleanupVerified = terminal || (['notRequired', 'semanticCleanupCompleted'].includes(failure?.semanticCleanupResultCode) &&
      ['exactProductsAbsent', 'exactProductsAbsentAfterCleanup'].includes(failure?.postconditionResultCode));
    if (state.safetyErrorCode === null && cleanupVerified) {
      await filesystem('remove', { root: state.runRoot });
      state.fixtureRemoved = true;
      state.fixtureCleanupResultCode = 'fixtureRemoved';
    }
  } else if (phase === 'publish' || phase === 'publishFailure') {
    return publish(context);
  } else invalid();
  return 0;
}

function commandOutcome(context, terminal, failure) {
  const { state, reports } = context;
  const common = { schemaVersion: 1, scenario: 'historicalLegacyUpgrade',
    processTreeAbsent: reports.scenario.processTreeAbsent, productProcessAbsent: true,
    filesystemProcessAbsent: true, filesystemOperation: 'notFailed', filesystemErrorCode: null,
    phaseWriterResultCode: 'writerAbsent', phaseDiagnosticResultCode: 'notSent',
    safetyErrorCode: state.safetyErrorCode, fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' };
  if (failure || state.safetyErrorCode) return { ...common, ...failure, status: 'failed',
    errorCode: failure?.errorCode ?? state.safetyErrorCode };
  return { ...common, status: 'completed', resultCode: 'historicalLegacyUpgradeCompleted',
    sourceClassification: state.artifact.source.artifactClass, sourceVersion: state.artifact.source.appVersion,
    targetVersion: state.artifact.target.appVersion, sourcePackageSha256: state.artifact.source.packageSha256,
    targetPackageSha256: state.artifact.target.packageSha256,
    legacyBusinessFixtureValidated: terminal.semanticProof.businessDataPreserved,
    adoptedWorkspaceCount: terminal.semanticProof.adoptedWorkspaceCount,
    idempotentSecondStartup: terminal.semanticProof.idempotentSecondStartup, businessDataPreserved: true,
    profileFileCountBefore: state.profileBefore.filter((item) => item.kind === 'file').length,
    profileFileCountAfter: state.profileAfter.filter((item) => item.kind === 'file').length,
    supervisorProcessResultCode: reports.scenario.processResultCode,
    supervisorWorkerResultCode: reports.scenario.workerResultCode,
    supervisorCleanupResultCode: reports.scenario.cleanupResultCode,
    scenarioResultCode: terminal.scenarioResult.resultCode, semanticProofResultCode: terminal.semanticProof.resultCode,
    semanticCleanupResultCode: 'semanticCleanupCompleted', postconditionResultCode: 'exactProductsAbsent' };
}

async function publish(context) {
  const { state, reports, history, resultPath, commandArguments, phase } = context;
  const caller = parseLegacyCallerArguments(commandArguments, parseLegacyUpgradeArguments).binding;
  let outcome;
  if (phase === 'publishFailure') {
    const firstFailure = history.find((item) => item.exitCode !== 0);
    let originalError = !firstFailure || reports[firstFailure.phase]?.processResultCode === 'deadlineExceeded'
      ? 'WINDOWS_ACCEPTANCE_SUPERVISOR_DEADLINE_EXCEEDED' : 'WINDOWS_ACCEPTANCE_LEGACY_UNEXPECTED_FAILURE';
    if (firstFailure?.phase === 'scenario') {
      try { originalError = (await terminalPlan(context)).errorCode ?? originalError; } catch { /* Preserve supervisor failure. */ }
    } else if (firstFailure) {
      try {
        const error = await readJson(resolve(context.commandRoot, firstFailure.phase, 'phase-error.json'));
        if (exact(error, ['binding', 'errorCode']) && error.binding.runNonce === firstFailure.runNonce &&
          error.binding.artifactDescriptorSha256 === caller.artifactDescriptorSha256 && LEGACY_COMMAND_ERROR_CODES.includes(error.errorCode))
          originalError = error.errorCode;
      } catch { /* Absent details never erase the observed process failure. */ }
    }
    let failureDetails;
    if (reports.scenario) {
      try { failureDetails = (await terminalOutcome(context)).failure; } catch { /* Unreadable business evidence cannot authorize cleanup. */ }
    }
    outcome = { ...failureDetails, schemaVersion: 1, scenario: 'historicalLegacyUpgrade', status: 'failed',
      errorCode: originalError,
      processTreeAbsent: reports.scenario?.processTreeAbsent === true, productProcessAbsent: true,
      fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' };
  } else {
    // Terminal facts are recorded before fixture removal, not reconstructed
    // from removed business files or guessed from a successful uninstall.
    const saved = await readJson(resolve(context.commandRoot, 'fixtureCleanup', 'terminal.json'));
    const item = history.find((entry) => entry.phase === 'fixtureCleanup');
    if (!exact(saved, ['binding', 'outcome']) || !exact(saved.binding, Object.keys(context.binding)) ||
      saved.binding.schemaVersion !== 1 || saved.binding.runNonce !== item.runNonce ||
      saved.binding.scenario !== 'acceptanceCommandPhase' || saved.binding.artifactDescriptorSha256 !== caller.artifactDescriptorSha256) invalid();
    outcome = saved.outcome;
    if (state.fixtureRemoved) await lstat(state.runRoot).then(invalid, (error) => { if (error.code !== 'ENOENT') throw error; });
    outcome.fixtureRemoved = state.fixtureRemoved;
    outcome.fixtureCleanupResultCode = state.fixtureCleanupResultCode;
  }
  const result = validateLegacyCallerResult({ binding: caller, outcome }, caller);
  await legacyCallerResultFile('publish', resultPath, result);
  return result.outcome.status === 'completed' ? 0 : 1;
}

export async function runLegacyCommandPhase(args, dependencies = {}) {
  let context;
  try {
    if (args.length !== 2 || args[0] !== '--phase-request') invalid();
    context = await readLegacyCommandPhase(args[1]);
    const code = await executeLegacyCommandPhase(context, dependencies);
    if (context.phase !== 'scenario') await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-state.json'),
      { binding: context.binding, state: context.state });
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'worker-result.json'), { ...context.binding,
      status: code === 0 ? 'completed' : 'failed', resultCode: code === 0 ? 'phaseCompleted' : 'phaseFailed',
      errorCode: code === 0 ? null : 'phaseFailed' });
    return code;
  } catch (error) {
    if (context) {
      try { await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'), { binding: context.binding, errorCode: safeCode(error) }); }
      catch { /* Required result absence remains a failure; never print a raw error. */ }
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runLegacyCommandPhase(process.argv.slice(2));
}
