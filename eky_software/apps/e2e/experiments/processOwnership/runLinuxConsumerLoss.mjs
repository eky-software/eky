import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { exactKeys, experimentContext } from './pidNamespaceContract.mjs';
import { validEvidenceBinding } from './linuxPrerequisiteContract.mjs';
import { guardLinuxService } from './linuxServiceContract.mjs';
import { linuxConsumerLossCases, linuxConsumerPhases, requireConsumerLoss } from './linuxConsumerLossContract.mjs';
import { linuxConsumerLossBuildPaths, verifyLinuxConsumerLossBuild } from './linuxConsumerLossBuild.mjs';
import { consumerCaseStages, runLinuxConsumerLossCase } from './runLinuxConsumerLossCase.mjs';

const stateKeys = ['caseId', 'stage', 'outcome', 'registered', 'passive', 'callerClosed', 'commandsClosed',
  'sentinelPreserved', 'retentionVerified', 'takeover', 'forcedCaller', 'callerFailurePhase'];
const scopes = Object.freeze({ system: 'system-api', web: 'web-chromium' });

export function writeConsumerLine(line, stream = process.stdout) {
  return new Promise((resolve, reject) => {
    stream.write(line, error => error ? reject(error) : resolve());
  });
}

export function consumerCasesForScope(scope) {
  requireConsumerLoss(Object.hasOwn(scopes, scope));
  return linuxConsumerLossCases.filter(value => (value.profile === 'backend') === (scope === 'system'));
}

export function serializeConsumerCaseResult(binding, state) {
  requireConsumerLoss(validEvidenceBinding(binding) && exactKeys(state, stateKeys));
  const selected = linuxConsumerLossCases.find(value => value.id === state.caseId);
  requireConsumerLoss(selected && consumerCaseStages.includes(state.stage) &&
    ['complete', 'incomplete'].includes(state.outcome) &&
    (state.callerFailurePhase === null || linuxConsumerPhases.includes(state.callerFailurePhase)) &&
    ['notAttempted', 'unverified', 'completed'].includes(state.takeover) &&
    ['callerClosed', 'commandsClosed', 'sentinelPreserved', 'retentionVerified', 'forcedCaller']
      .every(key => typeof state[key] === 'boolean') &&
    ['registered', 'passive'].every(key => Number.isSafeInteger(state[key]) && state[key] >= 0 &&
      state[key] <= selected.profiles.length) && state.passive <= state.registered &&
    binding.consumer === (selected.profile === 'backend' ? scopes.system : scopes.web));
  if (state.outcome === 'complete') {
    requireConsumerLoss(state.stage === 'complete' && state.registered === selected.profiles.length &&
      state.passive === (selected.cause === 'caller' ? selected.profiles.length : 1) &&
      state.callerClosed && state.commandsClosed && state.sentinelPreserved && state.retentionVerified &&
      !state.forcedCaller && state.callerFailurePhase === null &&
      state.takeover === (selected.cause === 'caller' ? 'completed' : 'notAttempted'));
  } else requireConsumerLoss(state.stage !== 'complete');
  return 'EKY_LINUX_CONSUMER_RESULT ' + JSON.stringify({ schemaVersion: 1, operation: 'consumerLoss',
    ...binding, ...Object.fromEntries(stateKeys.map(key => [key, state[key]])) }) + '\n';
}

async function loadBuild() {
  const repositoryRoot = realpathSync(fileURLToPath(new URL('../../../../', import.meta.url)));
  const paths = linuxConsumerLossBuildPaths(repositoryRoot);
  const receiptPath = paths.output + '.build.json';
  const stat = lstatSync(receiptPath);
  requireConsumerLoss(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size < 4096);
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  requireConsumerLoss(exactKeys(receipt, ['sourceIdentity', 'outputIdentity', 'fileCount']) &&
    /^[a-f0-9]{64}$/u.test(receipt.sourceIdentity) && /^[a-f0-9]{64}$/u.test(receipt.outputIdentity) &&
    Number.isSafeInteger(receipt.fileCount));
  const verified = verifyLinuxConsumerLossBuild(repositoryRoot, receipt);
  requireConsumerLoss(verified.fileCount === receipt.fileCount);
  const { default: config } = await import(pathToFileURL(posix.join(paths.output, 'playwright.config.js')).href);
  const { createE2eRunRoot: createRunRoot } = await import(pathToFileURL(
    posix.join(paths.output, 'src/environment/createE2eRunRoot.js')).href);
  return { repositoryRoot, config, createRunRoot,
    actorEntry: posix.join(paths.output, 'experiments/processOwnership/linuxConsumerLossActor.mjs') };
}

// Manual, first-attempt diagnostics only. The ordinary runner and endurance
// commands remain separate acceptance gates; a failed case never starts another.
export async function runLinuxConsumerLossCli({ argv, runtime = process, executeCase = runLinuxConsumerLossCase,
  load = loadBuild, guard = guardLinuxService, writeLine = writeConsumerLine,
}) {
  try {
    guard(runtime);
    requireConsumerLoss(Array.isArray(argv) && argv.length === 3 && typeof argv[0] === 'string' &&
      argv[0].startsWith('--scope='));
    const scope = argv[0].slice(8);
    const selected = consumerCasesForScope(scope);
    const binding = experimentContext(argv.slice(1), runtime.env);
    requireConsumerLoss(binding && binding.consumer === scopes[scope]);
    const build = await load();
    for (const value of selected) {
      const result = await executeCase({ ...build, caseId: value.id });
      requireConsumerLoss(result?.caseId === value.id);
      await writeLine(serializeConsumerCaseResult(binding, result));
      if (result.outcome !== 'complete') return 1;
    }
    return 0;
  } catch {
    try { await writeLine('EKY_LINUX_CONSUMER_REJECTED\n'); } catch { /* The failure exit remains authoritative. */ }
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let outputFailed = false;
  process.stdout.on('error', () => { outputFailed = true; process.exitCode = 1; });
  const code = await runLinuxConsumerLossCli({ argv: process.argv.slice(2) });
  process.exitCode = outputFailed ? 1 : code;
}
