import { randomBytes } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readCommandPhaseJson } from './acceptanceCommandPhaseInput.mjs';
import { readLegacyCommandPhase } from './legacyCommandPhase.mjs';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };

const worker = fileURLToPath(new URL('./legacyCommandWorkerFixture.mjs', import.meta.url));

// Preparation only: the CI step invokes the existing command fixture directly.
export async function prepareCaptureCutoffFixture(root, temporaryRoot) {
  await mkdir(root);
  const descriptor = join(root, 'legacy-upgrade-artifact.json');
  const resultPath = join(temporaryRoot, `eky-legacy-caller-${randomBytes(16).toString('hex')}`, 'result.json');
  await writeFile(descriptor, JSON.stringify({ testCase: 'scenarioHold' }), { flag: 'wx' });
  await writeFile(join(root, 'request.json'), JSON.stringify({
    node: process.execPath, testCase: 'scenarioHold', useCanonicalBudgets: true, worker,
    arguments: ['--legacy-command', '--artifact-descriptor', descriptor,
      '--expected-descriptor-sha256', 'a'.repeat(64), '--expected-build-revision', 'b'.repeat(40),
      '--result-path', resultPath],
  }), { flag: 'wx' });
}

async function resultAvailability(path) {
  try { await lstat(path); return 'present'; }
  catch (error) { return error?.code === 'ENOENT' ? 'missing' : 'unreadable'; }
}

export function summarizeCaptureCutoff({ stepOutcome, phasePrepared, callerResult, phaseResult, followingPhases }) {
  const availability = (value) => ['missing', 'present', 'unreadable'].includes(value) ? value : 'unavailable';
  const completed = stepOutcome === 'failure' && phasePrepared === true &&
    callerResult === 'missing' && phaseResult === 'missing' && followingPhases === 'absent';
  return { schemaVersion: 1, operation: 'installerCaptureCutoffDiagnostic', phase: 'commandObservation',
    status: completed ? 'completed' : 'failed', resultCode: completed ? 'diagnosticOnly' : 'diagnosticUnverified',
    testStepOutcome: ['failure', 'success', 'cancelled', 'skipped'].includes(stepOutcome) ? stepOutcome : 'unknown',
    lastPreparedPhase: phasePrepared === true ? 'scenario' : 'notObserved',
    callerResult: availability(callerResult), phaseResult: availability(phaseResult),
    followingPhases: followingPhases === 'absent' ? 'absent' : 'unverified',
    cleanup: 'notInferred', cause: 'notEstablished', evidenceRetention: 'retained' };
}

export async function observeCaptureCutoff(root, temporaryRoot, stepOutcome) {
  const observation = { stepOutcome, phasePrepared: false, callerResult: 'unavailable', phaseResult: 'unavailable' };
  try {
    const request = await readCommandPhaseJson(join(root, 'request.json'));
    const resultPath = request.arguments?.[8];
    if (request.testCase !== 'scenarioHold' || request.useCanonicalBudgets !== true || request.worker !== worker ||
        !Array.isArray(request.arguments) || request.arguments.length !== 9 ||
        request.arguments.slice(0, 8).join('\0') !== ['--legacy-command', '--artifact-descriptor',
          join(root, 'legacy-upgrade-artifact.json'), '--expected-descriptor-sha256', 'a'.repeat(64),
          '--expected-build-revision', 'b'.repeat(40), '--result-path'].join('\0') ||
        typeof resultPath !== 'string' || basename(resultPath) !== 'result.json' ||
        dirname(dirname(resultPath)) !== temporaryRoot || !/^eky-legacy-caller-[0-9a-f]{32}$/.test(basename(dirname(resultPath)))) {
      throw new Error('cutoffFixtureBindingInvalid');
    }
    observation.callerResult = await resultAvailability(resultPath);
    const marker = join(root, 'command-root.txt');
    const info = await lstat(marker);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > 4096) throw new Error('cutoffMarkerInvalid');
    const commandRoot = await readFile(marker, 'utf8');
    if (dirname(commandRoot) !== temporaryRoot || !/^eky-acceptance-command-[0-9a-f]{32}$/.test(basename(commandRoot)) ||
        await realpath(commandRoot) !== commandRoot) throw new Error('cutoffCommandRootInvalid');
    const phase = await readLegacyCommandPhase(join(commandRoot, 'scenario', 'phase-input.json'));
    observation.phasePrepared = phase.phase === 'scenario' && phase.commandArguments.join('\0') === request.arguments.slice(1).join('\0');
    observation.phaseResult = await resultAvailability(join(commandRoot, 'scenario', 'result.json'));
    const phases = commandBudgets.legacyCommand.phases.map(([name]) => name);
    const following = [...phases.slice(phases.indexOf('scenario') + 1), 'publishFailure'];
    observation.followingPhases = (await Promise.all(following.map((name) => resultAvailability(join(commandRoot, name)))))
      .every((value) => value === 'missing') ? 'absent' : 'unverified';
  } catch { /* Missing or invalid evidence remains unverified, never a cleanup proof. */ }
  return summarizeCaptureCutoff(observation);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, ...extra] = process.argv.slice(2);
    if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_OS !== 'Windows' ||
        !/^[1-9][0-9]+$/.test(process.env.GITHUB_RUN_ID ?? '') || !/^[1-9][0-9]*$/.test(process.env.GITHUB_RUN_ATTEMPT ?? '') ||
        !isAbsolute(process.env.RUNNER_TEMP ?? '') || extra.length || !['prepare', 'report'].includes(mode)) {
      throw new Error('cutoffContextInvalid');
    }
    const root = join(await realpath(process.env.RUNNER_TEMP), 'eky-inspector-cutoff');
    const temporaryRoot = await realpath(tmpdir());
    if (mode === 'prepare') {
      await prepareCaptureCutoffFixture(root, temporaryRoot);
      console.log(JSON.stringify({ schemaVersion: 1, operation: 'installerCaptureCutoffDiagnostic',
        phase: 'prepare', status: 'completed', resultCode: 'diagnosticOnly' }));
    } else {
      const result = await observeCaptureCutoff(root, temporaryRoot, process.env.CUTOFF_STEP_OUTCOME);
      console.log(JSON.stringify(result));
      process.exitCode = result.status === 'completed' ? 0 : 1;
    }
  } catch {
    console.log(JSON.stringify({ schemaVersion: 1, operation: 'installerCaptureCutoffDiagnostic',
      phase: 'fixture', status: 'failed', resultCode: 'diagnosticUnverified' }));
    process.exitCode = 1;
  }
}
