import { CI_FAULT_SCENARIOS, CI_GATES, validateCiRiskPlan } from './ciRiskPolicy.mjs';

// This is a closed CI coverage map, not a dependency or scenario execution graph.
const FAULT_STEPS = {
  preUpdateRecoveryPointFailure: 'Verify pre-update recovery point failure',
  activeWorkspaceFirstStartFailure: 'Verify active workspace business and binary rollback',
  acceptanceInterruption: 'Verify interrupted acceptance recovery and restart',
  passiveWorkspaceMigrationFailure: 'Verify passive workspace migration recovery',
  binaryRollbackFailure: 'Verify binary rollback failure stays recovery-only',
};

export function requiredCiJobs(plan) {
  validateCiRiskPlan(plan);
  if (JSON.stringify(Object.keys(FAULT_STEPS)) !== JSON.stringify(CI_FAULT_SCENARIOS)) {
    throw new Error('CI_FAULT_COVERAGE_INVALID');
  }
  const repeat = (name, steps = []) => Array.from({ length: plan.repetitions }, (_, index) => ({
    name: `${name} ${index + 1}`, family: `${name} `, steps,
  }));
  const job = (name, steps = []) => ({ name, family: name, steps });
  const workspaceProducer = [job('Verify V2.6 artifact and runtime contracts'), job('Build workspace acceptance artifact once')];
  return {
    verify: [job('V2 cadence contracts (ubuntu-latest)', ['Verify risk and result contracts']),
      job('V2 cadence contracts (windows-latest)', ['Verify risk and result contracts']),
      job('Test, typecheck and build', ['Run tests', 'Run typecheck', 'Build backend', 'Build web', 'Build desktop'])],
    systemSecurity: [job('System security E2E', ['Run isolated system security E2E tests'])],
    webCritical: [job('Web critical E2E', ['Run critical web E2E journeys'])],
    electronCritical: [job('Windows Electron critical E2E', ['Run critical Electron E2E journeys'])],
    packageSmoke: [job('Windows Electron critical E2E', ['Package Windows desktop', 'Run packaged Windows smoke'])],
    windowsContracts: [job('Windows installer contract tests', ['Run deterministic installer tests', 'Run Windows process-contract tests serially']),
      job('Windows Job Object feasibility run 1', ['Run supervisor unit and process contracts']),
      job('Windows Job Object feasibility run 2', ['Run supervisor unit and process contracts'])],
    cleanLifecycle: [job('Build Windows acceptance artifact once',
      ['Build acceptance artifact once', 'Verify produced artifact bytes', 'Upload exact acceptance artifact']), ...repeat('Verify clean lifecycle run',
      ['Run supervised clean lifecycle once', 'Reverify downloaded artifact bytes'])],
    upgradeRollback: [job('Build upgrade acceptance artifact once'), ...repeat('Verify upgrade and rollback run',
      ['Run supervised upgrade and rollback once', 'Reverify downloaded artifact bytes'])],
    legacyUpgrade: [...['core', 'commands', 'legacy-entry', 'workspace-success-entry', 'workspace-fault-entry'].flatMap((group) => repeat(`V2.5 ${group} contracts run`,
      ['Prepare locked package manager', 'Build existing supervisor once', `Run legacy ${group} contracts`])), job('Build one historical source and target phase artifact'),
      ...repeat('V2.5 packaged legacy phase run', ['Run existing supervised legacy lifecycle once', 'Reverify phase artifact bytes after lifecycle'])],
    workspaceSuccess: [...workspaceProducer, ...repeat('Verify packaged workspace success run',
      ['Prepare existing supervisor and proof readers once', 'Run supervised workspace success once', 'Reverify downloaded workspace artifact'])],
    workspaceFault: [...workspaceProducer, ...repeat('Verify packaged workspace fault recovery run',
      ['Prepare existing supervisor and proof readers once', ...plan.faultScenarios.map((scenario) => FAULT_STEPS[scenario]), 'Reverify downloaded workspace artifact'])],
  };
}

export function verifyCiJobCoverage(plan, jobs) {
  const required = requiredCiJobs(plan);
  if (!Array.isArray(jobs) || jobs.length === 0 || jobs.length > 1000 ||
    new Set(jobs.map((job) => job.id)).size !== jobs.length || jobs.some((job) =>
      !Number.isSafeInteger(job.id) || job.id < 1 || typeof job.name !== 'string' || job.name.length > 300 ||
      !['queued', 'in_progress', 'completed', 'waiting', 'pending'].includes(job.status))) {
    throw new Error('CI_JOB_EVIDENCE_INVALID');
  }
  // GitHub prefixes reusable jobs with their caller name; duplicate leaf names fail closed.
  const leaf = (job) => job.name.split(' / ').at(-1);
  const expectedNames = new Set(CI_GATES.filter((gate) => plan.gates[gate]).flatMap((gate) => required[gate].map((job) => job.name)));
  const families = new Set(Object.values(required).flat().map((job) => job.family));
  for (const job of jobs) {
    const name = leaf(job);
    if ([...families].some((family) => name.startsWith(family)) && !expectedNames.has(name) && job.conclusion !== 'skipped') {
      throw new Error('CI_UNEXPECTED_MATRIX_MEMBER');
    }
  }
  for (const gate of CI_GATES.filter((name) => plan.gates[name])) {
    for (const expected of required[gate]) {
      const matches = jobs.filter((job) => leaf(job) === expected.name);
      if (matches.length !== 1 || matches[0].status !== 'completed' || matches[0].conclusion !== 'success') {
        throw new Error('CI_REQUIRED_JOB_INCOMPLETE');
      }
      for (const name of expected.steps) {
        const steps = matches[0].steps?.filter((step) => step.name === name);
        if (steps?.length !== 1 || steps[0].status !== 'completed' || steps[0].conclusion !== 'success') {
          throw new Error('CI_REQUIRED_STEP_INCOMPLETE');
        }
      }
    }
  }
}
