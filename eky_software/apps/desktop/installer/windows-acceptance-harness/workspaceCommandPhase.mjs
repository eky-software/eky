import { lstat, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseWorkspaceSuccessArguments, parseWorkspaceFaultArguments } from './workspaceCommandAdmission.mjs';
import { parseWorkspaceCallerCliArguments, validateWorkspaceCallerResult } from './workspaceCallerResult.mjs';
import { workspaceCallerResultFile } from './workspaceCallerResultFile.mjs';
import { verifyWorkspaceSuccessArtifact } from './workspaceSuccessArtifact.mjs';
import { createWorkspaceSuccessRequest, readWorkspaceSuccessResult, workspaceSuccessResultPath,
  workspaceSuccessErrorCode, writeJsonAtomicExclusive } from './workspaceSuccessContracts.mjs';
import { createWorkspaceFaultRequest, readWorkspaceFaultResult, workspaceFaultResultPath,
  workspaceFaultErrorCode } from './workspaceFaultContracts.mjs';
import { materializeWorkspaceSuccessArtifactFixture, prepareWorkspaceSuccessRunFixture,
  WORKSPACE_SUCCESS_RUN_ROOT_PREFIX, workspaceSuccessRunContext } from './workspaceSuccessRunFixture.mjs';
import { requireWorkspaceSuccessProductPrecondition, prepareWorkspaceSuccessTerminalOutcome,
  prepareWorkspaceFaultTerminalOutcome, completeWorkspaceTerminalOutcome,
  workspaceSuccessRunRootRemovable } from './workspaceSuccessFailureBoundary.mjs';
import { loadWorkspaceSuccessProfileSupport } from './workspaceSuccessProfileEvidence.mjs';
import { loadWorkspaceFaultProfileSupport } from './workspaceFaultProfileEvidence.mjs';
import { verifyWorkspaceSuccessSemanticPostcondition } from './workspaceSuccessPostcondition.mjs';
import { verifyWorkspaceFaultSemanticPostcondition } from './workspaceFaultPostcondition.mjs';
import { verifyWorkspaceFaultSessionEvidence } from './workspaceFaultSessionEvidence.mjs';
import { runWorkspaceSuccessWorker } from './runWorkspaceSuccessWorker.mjs';
import { runWorkspaceFaultWorker } from './runWorkspaceFaultWorker.mjs';
import { createClosedDirectoryInventory, inventoriesMatch } from './closedDirectoryInventory.mjs';
import { inspectLegacyInstallerFootprint } from './legacyUpgradeWindowsRuntime.mjs';
import { executeProductOperation } from './installerProductOperationWorker.mjs';
import { acceptanceProductPair, acceptanceProductCleanup, validateAcceptanceProductFacts } from './acceptanceProductFacts.mjs';
import { readAcceptanceCommandPhase, readCommandPhaseJson, hasExactPhaseKeys } from './acceptanceCommandPhaseInput.mjs';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

const DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PHASES = commandBudgets.workspaceCommand.phases.map(([name]) => name);
const STATE_KEYS = ['runRoot', 'artifact', 'profileBefore', 'profileAfter', 'products',
  'semanticProof', 'sessionProof', 'removalProof', 'safetyErrorCode', 'fixtureRemoved', 'fixtureCleanupResultCode'];
const invalid = () => { throw new Error('requestInvalid'); };
const isFault = (context) => context.commandKind === 'workspaceFault';
const productPair = (context, suffix) => acceptanceProductPair(context.state.products, suffix);
const errorCode = (error, fault) => ['productStateVerificationFailed', 'semanticCleanupFailed', 'fixtureCleanupFailed']
  .includes(error?.message) ? error.message : (fault ? workspaceFaultErrorCode : workspaceSuccessErrorCode)(error);

export async function readWorkspaceCommandPhase(path) {
  const raw = await readCommandPhaseJson(path);
  if (!['workspaceSuccess', 'workspaceFault'].includes(raw.commandKind)) invalid();
  return readAcceptanceCommandPhase(path, { commandKind: raw.commandKind, phases: PHASES,
    parseArguments: (args) => parseWorkspaceCallerCliArguments(args,
      raw.commandKind === 'workspaceFault' ? parseWorkspaceFaultArguments : parseWorkspaceSuccessArguments),
    createState: () => ({ runRoot: null, artifact: null, profileBefore: null, profileAfter: null, products: {},
      semanticProof: null, sessionProof: null, removalProof: null, safetyErrorCode: null,
      fixtureRemoved: false, fixtureCleanupResultCode: 'retainedUnverified' }),
    async validateState(state, input) {
      if (!hasExactPhaseKeys(state, STATE_KEYS) || typeof state.fixtureRemoved !== 'boolean') invalid();
      validateAcceptanceProductFacts(state.products, input.history);
      if (state.runRoot !== null && (dirname(state.runRoot) !== await realpath(tmpdir()) ||
        !new RegExp(`^${WORKSPACE_SUCCESS_RUN_ROOT_PREFIX}[a-zA-Z0-9]{6}$`).test(basename(state.runRoot)) ||
        (state.artifact && (state.artifact.artifactRoot !== resolve(state.runRoot, 'fixture') ||
          state.artifact.descriptorSha256 !== input.commandArguments[3] ||
          state.artifact.buildRevision !== input.commandArguments[5])))) invalid();
    },
  });
}

function artifactInput(context, root = dirname(context.commandArguments[1])) {
  return { artifactRoot: root, expectedDescriptorSha256: context.callerBinding.artifactDescriptorSha256,
    expectedBuildRevision: context.callerBinding.buildRevision };
}

function runContext(context) {
  const request = (isFault(context) ? createWorkspaceFaultRequest : createWorkspaceSuccessRequest)({
    runNonce: context.scenarioRunNonce, artifactDescriptorSha256: context.callerBinding.artifactDescriptorSha256,
    buildRevision: context.callerBinding.buildRevision, faultScenario: context.callerBinding.faultScenario,
    fixtureRoot: context.state.artifact.artifactRoot });
  const requestPath = resolve(context.state.runRoot, 'scenario', 'worker-request.json');
  return { ...workspaceSuccessRunContext(requestPath, request, context.state.artifact), requestPath };
}

async function terminalPlan(context, semantic = () => context.state.semanticProof, sessions = () => context.state.sessionProof) {
  const runtime = runContext(context);
  const read = isFault(context) ? readWorkspaceFaultResult : readWorkspaceSuccessResult;
  const resultPath = (isFault(context) ? workspaceFaultResultPath : workspaceSuccessResultPath)(runtime.requestPath);
  return (isFault(context) ? prepareWorkspaceFaultTerminalOutcome : prepareWorkspaceSuccessTerminalOutcome)({
    request: runtime.request, supervisorResult: context.reports.scenario,
    productPrecondition: productPair(context, 'Before'), readScenarioResult: () => read(resultPath, runtime.request),
    verifyExactProductStates: () => productPair(context, 'After'),
    verifySemanticPostcondition: async () => restoreProof(await semantic(runtime)),
    verifySessionPostcondition: async () => restoreProof(await sessions(runtime)),
  });
}

function restoreProof(proof) {
  if (proof?.status === 'failed') throw new Error(proof.errorCode);
  return proof;
}

async function terminalOutcome(context) {
  return completeWorkspaceTerminalOutcome(await terminalPlan(context), {
    cleanupExactProducts: () => acceptanceProductCleanup(context.state.products),
    verifyExactProductStates: () => productPair(context, 'Final'),
    verifyRemovalPostcondition: () => context.state.removalProof,
  });
}

async function readNormalProfile() {
  const root = resolve(process.env.APPDATA, 'Eky');
  const present = await lstat(root).then(() => true, (error) => { if (error.code === 'ENOENT') return false; throw error; });
  return { present, inventory: await createClosedDirectoryInventory(root) };
}

async function verifyRemoval() {
  const root = resolve(process.env.LOCALAPPDATA, 'Programs', 'Eky');
  const footprint = await inspectLegacyInstallerFootprint({ installRoot: root, executablePath: resolve(root, 'Eky.exe'),
    shortcutPath: resolve(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Eky', 'Eky.lnk') });
  if (Object.values(footprint).some((value) => value !== false)) throw new Error('installerFootprintUnverified');
  return { status: 'completed', resultCode: 'installerFootprintAbsent' };
}

async function verifySemantic(context, fault) {
  return fault ? verifyWorkspaceFaultSemanticPostcondition({ ...context, support: await loadWorkspaceFaultProfileSupport() })
    : verifyWorkspaceSuccessSemanticPostcondition({ ...context, support: await loadWorkspaceSuccessProfileSupport() });
}

async function runProduct(context, dependencies) {
  const { phase, state } = context;
  const uninstall = phase.startsWith('uninstall');
  if (phase.endsWith('Cleanup') || uninstall) {
    const plan = await terminalPlan(context);
    if (plan.terminal || !plan.cleanupAllowed || plan.initial.resultCode === 'exactProductsAbsent') return;
    if (uninstall) {
      const pair = productPair(context, 'Cleanup');
      if (pair.status !== 'completed') throw new Error('productStateVerificationFailed');
      if (!pair[`${phase.includes('Source') ? 'source' : 'target'}Present`]) return;
    }
  }
  const artifact = await (dependencies.verifyArtifact ?? verifyWorkspaceSuccessArtifact)(artifactInput(context, state.artifact.artifactRoot));
  const role = phase.includes('Source') ? 'source' : 'target';
  state.products[phase] = await (dependencies.executeProduct ?? executeProductOperation)({ schemaVersion: 1,
    nonce: context.binding.runNonce, operation: uninstall ? 'uninstall' : 'inspect', productCode: `{${artifact[role].productCode}}`,
    scenarioRoot: context.phaseRoot, nodeExecutable: process.execPath, workerPath: resolve(DIRECTORY, 'installerProductOperationWorker.mjs'),
    timeoutMilliseconds: uninstall ? 125000 : 35000, cleanupReserveMilliseconds: 5000, deliveryReserveMilliseconds: 1000 });
}

export async function executeWorkspaceCommandPhase(context, dependencies = {}) {
  const { phase, state } = context;
  const fault = isFault(context);
  if (phase === 'prepare') {
    if (!process.env.APPDATA || !process.env.LOCALAPPDATA) invalid();
    await workspaceCallerResultFile('prepare', context.resultPath, context.callerBinding);
    state.runRoot = await mkdtemp(resolve(await realpath(tmpdir()), WORKSPACE_SUCCESS_RUN_ROOT_PREFIX));
  } else if (phase === 'inventoryBefore') state.profileBefore = await (dependencies.inventoryProfile ?? readNormalProfile)();
  else if (phase === 'materialize') {
    state.artifact = await (dependencies.materializeFixture ?? materializeWorkspaceSuccessArtifactFixture)(artifactInput(context), resolve(state.runRoot, 'fixture'));
    if (state.artifact.descriptorSha256 !== context.callerBinding.artifactDescriptorSha256 ||
      state.artifact.buildRevision !== context.callerBinding.buildRevision) throw new Error('artifactInvalid');
  } else if (phase.startsWith('inspect') || phase.startsWith('uninstall')) {
    await runProduct(context, dependencies);
    if (state.products[phase]?.status === 'failed') {
      await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'), { binding: context.binding,
        errorCode: phase.startsWith('uninstall') ? 'semanticCleanupFailed' : 'productStateVerificationFailed' });
      return 1;
    }
  }
  else if (phase === 'scenarioPreparation') {
    requireWorkspaceSuccessProductPrecondition(productPair(context, 'Before'));
    const runtime = runContext(context);
    await mkdir(runtime.scenarioRoot);
    await (dependencies.prepareFixture ?? prepareWorkspaceSuccessRunFixture)(runtime);
    await writeJsonAtomicExclusive(runtime.requestPath, runtime.request);
  } else if (phase === 'scenario') {
    return (dependencies.runScenario ?? (fault ? runWorkspaceFaultWorker : runWorkspaceSuccessWorker))(['--request', runContext(context).requestPath]);
  } else if (phase === 'semantic') {
    await terminalPlan(context, async (runtime) => {
      try { state.semanticProof = await (dependencies.verifySemantic ?? verifySemantic)(runtime, fault); }
      catch (error) { state.semanticProof = { status: 'failed', errorCode: errorCode(error, fault) }; }
      return state.semanticProof;
    }, async (runtime) => {
      try { state.sessionProof = await (dependencies.verifySessions ?? verifyWorkspaceFaultSessionEvidence)(runtime); }
      catch { state.sessionProof = { status: 'failed', errorCode: 'sessionProofInvalid' }; }
      return state.sessionProof;
    });
  } else if (phase === 'removal') {
    if (productPair(context, 'Final').resultCode === 'exactProductsAbsent') {
      try { state.removalProof = await (dependencies.verifyRemoval ?? verifyRemoval)(); }
      catch { state.removalProof = { status: 'failed', resultCode: 'installerFootprintUnverified' }; }
    }
  } else if (phase === 'artifact') {
    try {
      await (dependencies.verifyArtifact ?? verifyWorkspaceSuccessArtifact)(artifactInput(context));
      await (dependencies.verifyArtifact ?? verifyWorkspaceSuccessArtifact)(artifactInput(context, state.artifact.artifactRoot));
    } catch { state.safetyErrorCode ??= 'artifactChanged'; }
  } else if (phase === 'inventoryAfter') {
    try {
      state.profileAfter = await (dependencies.inventoryProfile ?? readNormalProfile)();
      if (!profilesMatch(state)) throw new Error();
    } catch { state.safetyErrorCode ??= 'normalProfileChanged'; }
  } else if (phase === 'fixtureCleanup') {
    const terminal = await terminalOutcome(context);
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'terminal.json'), { binding: context.binding, terminal });
    if (state.safetyErrorCode === null && workspaceSuccessRunRootRemovable({ supervisorAttempted: true, terminal, productProcessAbsent: true })) {
      const info = await lstat(state.runRoot);
      if (!info.isDirectory() || info.isSymbolicLink() || await realpath(state.runRoot) !== state.runRoot) invalid();
      await (dependencies.removeFixture ?? ((root) => rm(root, { recursive: true })))(state.runRoot);
      await requireAbsent(state.runRoot);
      state.fixtureRemoved = true;
      state.fixtureCleanupResultCode = 'fixtureRemoved';
    }
  } else if (phase === 'publish' || phase === 'publishFailure') return publish(context);
  else invalid();
  return 0;
}

function profilesMatch(state) {
  return state.profileBefore !== null && state.profileAfter !== null && state.profileBefore.present === state.profileAfter.present &&
    inventoriesMatch(state.profileBefore.inventory, state.profileAfter.inventory);
}

async function requireAbsent(path) {
  await lstat(path).then(invalid, (error) => { if (error.code !== 'ENOENT') throw error; });
}

async function publish(context) {
  const { state, callerBinding, reports } = context;
  let terminal;
  if (context.phase === 'publishFailure') {
    let originalError;
    try {
      if (reports.scenario) {
        originalError = (await terminalPlan(context)).result.errorCode;
        terminal = await terminalOutcome(context);
      }
    } catch { /* Do not replace the observed phase failure. */ }
    const failure = context.history.find((item) => item.exitCode !== 0);
    let code = reports[failure?.phase]?.processResultCode === 'deadlineExceeded' ? 'supervisorDeadlineExceeded' : 'supervisorFailed';
    if (failure && reports[failure.phase].processResultCode === 'processExitFailed' && failure.phase !== 'scenario') {
      try {
        const saved = await readCommandPhaseJson(resolve(context.commandRoot, failure.phase, 'phase-error.json'));
        if (hasExactPhaseKeys(saved, ['binding', 'errorCode']) && hasExactPhaseKeys(saved.binding, Object.keys(context.binding)) &&
          saved.binding.schemaVersion === 1 && saved.binding.runNonce === failure.runNonce &&
          saved.binding.artifactDescriptorSha256 === callerBinding.artifactDescriptorSha256 && saved.binding.scenario === 'acceptanceCommandPhase')
          code = errorCode({ message: saved.errorCode }, isFault(context));
      } catch { /* Missing diagnostics do not replace the observed process failure. */ }
    }
    terminal = { ...terminal, status: 'failed', errorCode: originalError ?? code };
  } else {
    const saved = await readCommandPhaseJson(resolve(context.commandRoot, 'fixtureCleanup', 'terminal.json'));
    const item = context.history.find((entry) => entry.phase === 'fixtureCleanup');
    if (!hasExactPhaseKeys(saved, ['binding', 'terminal']) || !hasExactPhaseKeys(saved.binding, Object.keys(context.binding)) ||
      saved.binding.schemaVersion !== 1 || saved.binding.runNonce !== item.runNonce ||
      saved.binding.artifactDescriptorSha256 !== callerBinding.artifactDescriptorSha256 || saved.binding.scenario !== 'acceptanceCommandPhase') invalid();
    terminal = saved.terminal;
    if (state.fixtureRemoved) await requireAbsent(state.runRoot);
  }
  const code = terminal.errorCode ?? state.safetyErrorCode ?? (state.fixtureRemoved ? null : 'fixtureCleanupFailed');
  const outcome = { ...terminal, schemaVersion: 1, scenario: callerBinding.scenario,
    ...(isFault(context) ? { faultScenario: callerBinding.faultScenario } : {}), status: code === null ? 'completed' : 'failed',
    errorCode: code, safetyErrorCode: state.safetyErrorCode, fixtureRemoved: state.fixtureRemoved,
    fixtureCleanupResultCode: state.fixtureCleanupResultCode, processTreeAbsent: reports.scenario?.processTreeAbsent === true,
    productProcessAbsent: true, phaseWriterResultCode: 'writerAbsent', phaseDiagnosticResultCode: 'notSent',
    businessDataPreserved: profilesMatch(state),
    profileFileCountBefore: state.profileBefore?.inventory.filter((entry) => entry.kind === 'file').length ?? null,
    profileFileCountAfter: state.profileAfter?.inventory.filter((entry) => entry.kind === 'file').length ?? null,
    ...(state.artifact ? { buildRevision: callerBinding.buildRevision, artifactDescriptorSha256: callerBinding.artifactDescriptorSha256,
      sourcePackageSha256: state.artifact.source.packageSha256, targetPackageSha256: state.artifact.target.packageSha256 } : {}) };
  await workspaceCallerResultFile('publish', context.resultPath, validateWorkspaceCallerResult({ binding: callerBinding, outcome }, callerBinding));
  return outcome.status === 'completed' ? 0 : 1;
}

export async function runWorkspaceCommandPhase(args, dependencies = {}) {
  let context;
  try {
    if (args.length !== 2 || args[0] !== '--phase-request') invalid();
    context = await readWorkspaceCommandPhase(args[1]);
    const code = await executeWorkspaceCommandPhase(context, dependencies);
    if (context.phase !== 'scenario') await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-state.json'),
      { binding: context.binding, state: context.state });
    await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'worker-result.json'), { ...context.binding,
      status: code === 0 ? 'completed' : 'failed', resultCode: code === 0 ? 'phaseCompleted' : 'phaseFailed', errorCode: code === 0 ? null : 'phaseFailed' });
    return code;
  } catch (error) {
    if (context) {
      try { await writeJsonAtomicExclusive(resolve(context.phaseRoot, 'phase-error.json'),
        { binding: context.binding, errorCode: errorCode(error, isFault(context)) }); } catch { /* Missing required evidence remains failure. */ }
    }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exitCode = await runWorkspaceCommandPhase(process.argv.slice(2));
}
