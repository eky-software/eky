import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, utilityProcess } from 'electron';
import { guardLinuxService } from '../../../e2e/experiments/processOwnership/linuxServiceContract.mjs';
import { readLinuxInspectionControl } from '../../../e2e/experiments/processOwnership/linuxServiceConfiguration.mjs';
import { assertInspectionProofResult, inspectionProofPaths, parseInspectionProofConfig,
  requireInspectionProof } from './linuxProfileInspectionContract.mjs';
import { runLinuxInspectionCase } from './linuxProfileInspectionCase.mjs';

const originalFork = utilityProcess.fork.bind(utilityProcess);
const observation = { forkCount: 0, exitObserved: false, exitCode: null, contextReads: 0,
  receiptVerified: false, sourcePreserved: false, mainExclusionProved: false, ownerReleaseProved: false };
const repository = fileURLToPath(new URL('../../../../', import.meta.url));
let phase = 'configuration';
let config;
let paths;
void run();

async function run() {
  let result;
  try {
    guardLinuxService();
    requireInspectionProof(process.argv.length === 3 && resolve(process.argv[1]) === fileURLToPath(import.meta.url));
    config = parseInspectionProofConfig(readLinuxInspectionControl(process.argv[2]));
    paths = inspectionProofPaths(process.argv[2], config, process.env.EKY_E2E_OS_TEMP_ROOT);
    app.setName('EKY Profile Inspection Proof');
    app.setPath('userData', paths.userData);
    app.setPath('crashDumps', paths.crashDumps);
    requireInspectionProof(app.requestSingleInstanceLock());
    const assertAuthority = () => requireInspectionProof(app.hasSingleInstanceLock());
    phase = 'applicationReady';
    await app.whenReady();
    utilityProcess.fork = (...args) => {
      const child = originalFork(...args);
      observation.forkCount += 1;
      child.once('exit', code => { observation.exitObserved = true; observation.exitCode = code; });
      return child;
    };
    const load = relative => import(pathToFileURL(resolve(repository, 'apps/desktop/dist', relative)));
    const ports = Object.assign({}, await load('main/desktopComposition.js'),
      await load('runtime/workspaceProcessReservation.js'), await load('runtime/profileInspectionProcess.js'),
      await load('runtime/profileInspectionFailure.js'), await load('profileBackup/runProfileSnapshotInspection.js'),
      await load('profileBackup/createProfileInspectionDeployment.js'));
    const terminal = await runLinuxInspectionCase({ config, paths, repository, ports, observation,
      assertAuthority, signal: new AbortController().signal, recordPhase: value => { phase = value; } });
    result = { schemaVersion: 1, generation: config.generation, variant: config.variant, ...terminal, phase, observation };
    if (result.status === 'passed') assertInspectionProofResult(result, config);
  } catch {
    if (config && paths) result = { schemaVersion: 1, generation: config.generation, variant: config.variant,
      status: 'failed', phase, causeCode: null, observation, ownerReleased: false };
  } finally { utilityProcess.fork = originalFork; }
  let delivered = false;
  if (result) {
    try {
      await writeFile(paths.result, JSON.stringify(result), { flag: 'wx', mode: 0o600 });
      delivered = true;
    } catch { /* The outer owner retains this case; missing evidence is a failure. */ }
  }
  if (!delivered || result?.status !== 'passed') process.stderr.write('LINUX_PROFILE_INSPECTION_PROOF_FAILED\n');
  app.exit(delivered && result?.status === 'passed' ? 0 : 1);
}
