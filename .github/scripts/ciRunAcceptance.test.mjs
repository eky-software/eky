import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { classifyCiChanges } from './classifyCiChanges.mjs';
import { classifyCiRisk } from './ciRiskPolicy.mjs';
import { requiredCiJobs } from './ciJobCoverage.mjs';
import { CI_WORKFLOWS, evaluateCiRun } from './ciRunAcceptance.mjs';
import { summarizeLegacyCapture } from './legacyCaptureObservation.mjs';
import { withoutOptionalEvidenceAllowance } from './ciFailureEvidenceTestContract.mjs';

const fast = 'eky_software/apps/web/src/features/customers/CustomerList.tsx';
const critical = 'eky_software/apps/desktop/src/profileBackup/restore/profileRestoreStartupRecovery.ts';
const planFor = (paths, eventName = 'pull_request') => classifyCiRisk({ eventName,
  ref: eventName === 'pull_request' ? 'refs/pull/1/merge' : 'refs/heads/main',
  changedPaths: paths, comparisonComplete: true });

function evidence(plan) {
  const selected = ['classification', 'cadence_contracts', 'core',
    ...(plan.gates.windowsContracts ? ['supervisor', 'clean', 'upgrade', 'workspace'] : []),
    ...(plan.gates.legacyUpgrade ? ['legacy'] : [])];
  const needs = Object.fromEntries(CI_WORKFLOWS.map((name) => [name, {
    result: selected.includes(name) ? 'success' : 'skipped', outputs: {},
  }]));
  const jobs = [];
  for (const [gate, members] of Object.entries(requiredCiJobs(plan))) {
    if (!plan.gates[gate]) continue;
    for (const member of members) {
      let job = jobs.find((value) => value.name === `caller / ${member.name}`);
      if (!job) {
        job = { id: jobs.length + 1, name: `caller / ${member.name}`, status: 'completed', conclusion: 'success', steps: [] };
        jobs.push(job);
      }
      for (const name of member.steps) if (!job.steps.some((step) => step.name === name)) {
        job.steps.push({ name, status: 'completed', conclusion: 'success' });
      }
    }
  }
  return { needs, jobs };
}

test('light, lifecycle, mixed and full-event changes select exact coverage and complete', () => {
  for (const [paths, event, count] of [
    [[fast], 'pull_request', 5], [[critical], 'pull_request', 25],
    [[fast, critical], 'pull_request', 25], [[fast], 'push', 36],
    [[fast], 'schedule', 36], [[fast], 'workflow_dispatch', 36],
  ]) {
    const plan = planFor(paths, event);
    const { needs, jobs } = evidence(plan);
    assert.equal(jobs.length, count);
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
  }
  const full = evidence(planFor([fast], 'push')).jobs.map((job) => job.name);
  for (const name of ['Verify clean lifecycle run 2', 'Verify upgrade and rollback run 2',
    'V2.5 packaged legacy phase run 2', 'Verify packaged workspace success run 2',
    'Verify packaged workspace fault recovery run 2']) assert.ok(full.includes(`caller / ${name}`));
});

test('legacy coverage requires every responsibility group and selected repetition before its producer', () => {
  for (const event of ['pull_request', 'push']) {
    const plan = planFor([critical], event);
    const expected = Array.from({ length: plan.repetitions }, (_, index) =>
      ['core', 'commands', 'legacy-entry', 'clean-upgrade-entry', 'workspace-success-entry', 'workspace-fault-entry']
        .map((group) => `caller / V2.5 ${group} contracts run ${index + 1}`)).flat();
    const original = evidence(plan);
    assert.deepEqual(original.jobs.filter((job) => /V2\.5 .* contracts run/.test(job.name))
      .map((job) => job.name).sort(), expected.sort());
    for (const name of expected) {
      for (const outcome of ['missing', 'cancelled', 'skipped', 'failure']) {
        const { needs, jobs } = structuredClone(original);
        const index = jobs.findIndex((job) => job.name === name);
        if (outcome === 'missing') jobs.splice(index, 1);
        else jobs[index].conclusion = outcome;
        assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_JOB_INCOMPLETE');
      }
      const group = name.match(/V2\.5 (.+) contracts run/)[1];
      for (const stepName of ['Prepare locked package manager', 'Build existing supervisor once', `Run legacy ${group} contracts`]) {
        const { needs, jobs } = structuredClone(original);
        const job = jobs.find((value) => value.name === name);
        job.steps = job.steps.filter((step) => step.name !== stepName);
        assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
      }
    }
  }
});

test('skipped manual MSI policy job does not replace mandatory normal policy steps', () => {
  const plan = planFor([critical], 'push');
  const { needs, jobs } = evidence(plan);
  jobs.push({ id: jobs.length + 1, name: 'supervisor / Synthetic MSI file-version policy',
    status: 'completed', conclusion: 'skipped', steps: [] });
  assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
  const required = jobs.find(job => job.name.endsWith('Windows installer contract tests'));
  required.steps.find(step => step.name === 'Verify synthetic MSI UI and file-version policy').conclusion = 'skipped';
  assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
});

test('deleted and moved critical paths flow from Git diff into required consumers', () => {
  const environment = { GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/1/merge',
    CI_BASE_SHA: 'a'.repeat(40), CI_HEAD_SHA: 'b'.repeat(40) };
  for (const paths of [[critical], [critical, fast]]) {
    const plan = classifyCiChanges(environment, { git: () => ({ status: 0,
      stdout: Buffer.from(`${paths.join('\0')}\0`) }) });
    const { needs, jobs } = evidence(plan);
    assert.ok(plan.gates.legacyUpgrade && plan.gates.workspaceFault);
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
    needs.legacy.result = 'skipped';
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed');
  }
  const full = classifyCiChanges(environment, { git: () => ({ status: 1 }) });
  assert.equal(full.repetitions, 2);
  const { needs, jobs } = evidence(full);
  needs.classification.result = 'failure';
  assert.equal(evaluateCiRun(full, needs, jobs).resultCode, 'classificationNotSuccessful');
});

test('optional legacy capture cannot replace either consumer or its mandatory results', () => {
  const plan = planFor([critical], 'push');
  for (const captureOutcome of ['success', 'failure', 'cancelled', 'skipped']) {
    const { needs, jobs } = evidence(plan);
    const consumer = jobs.find((job) => job.name.endsWith('legacy phase run 1'));
    const observation = summarizeLegacyCapture({ enabled: true, testOutcome: 'success',
      artifactOutcome: 'success', startOutcome: captureOutcome, stopOutcome: captureOutcome,
      analysisOutcome: captureOutcome });
    consumer.steps.push({ name: 'Optional inspector capture', status: 'completed',
      conclusion: 'success', outcome: captureOutcome });
    assert.equal(observation.testOutcome, 'success');
    assert.equal(evaluateCiRun(plan, needs, jobs).status, 'completed');
    jobs.splice(jobs.findIndex((job) => job.name.endsWith('legacy phase run 2')), 1);
    assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_JOB_INCOMPLETE');
  }

  for (const stepName of ['Run existing supervised legacy lifecycle once',
    'Reverify phase artifact bytes after lifecycle']) {
    for (const outcome of ['failure', 'cancelled', 'skipped', 'missing']) {
      const { needs, jobs } = evidence(plan);
      const consumer = jobs.find((job) => job.name.endsWith('legacy phase run 1'));
      consumer.steps.push({ name: 'Optional inspector capture', status: 'completed', conclusion: 'success' });
      const index = consumer.steps.findIndex((step) => step.name === stepName);
      assert.ok(index >= 0);
      if (outcome === 'missing') consumer.steps.splice(index, 1);
      else consumer.steps[index].conclusion = outcome;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
    }
  }
});

test('every selected job is mandatory even when reusable workflow result claims success', () => {
  const plan = planFor([critical], 'push');
  const original = evidence(plan);
  for (let index = 0; index < original.jobs.length; index++) {
    for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped', 'timed_out']) {
      const { needs, jobs } = structuredClone(original);
      if (conclusion === 'missing') jobs.splice(index, 1);
      else jobs[index].conclusion = conclusion;
      assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed', `${index}:${conclusion}`);
    }
  }
});

test('clean producer requires bundle verification and exact artifact delivery even when its job claims success', () => {
  const plan = planFor([critical], 'push');
  const original = evidence(plan);
  const producerName = 'caller / Build Windows acceptance artifact once';
  const requiredSteps = ['Build acceptance artifact once', 'Verify produced artifact bytes',
    'Upload exact acceptance artifact'];
  assert.deepEqual(original.jobs.find((job) => job.name === producerName).steps.map((step) => step.name),
    requiredSteps);
  assert.equal(evaluateCiRun(plan, original.needs, original.jobs).status, 'completed');
  for (const stepName of requiredSteps) {
    for (const outcome of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(original);
      const producer = jobs.find((job) => job.name === producerName);
      const index = producer.steps.findIndex((step) => step.name === stepName);
      if (outcome === 'missing') producer.steps.splice(index, 1);
      else producer.steps[index].conclusion = outcome;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE',
        `${stepName}:${outcome}`);
    }
  }
});

test('preparation, all five fault results and artifact revalidation are mandatory within each consumer', () => {
  const plan = planFor([critical], 'push');
  const original = evidence(plan);
  const index = original.jobs.findIndex((job) => job.name.endsWith('fault recovery run 2'));
  assert.equal(original.jobs[index].steps.length, 7);
  for (let step = 0; step < 7; step++) {
    for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(original);
      if (conclusion === 'missing') jobs[index].steps.splice(step, 1);
      else jobs[index].steps[step].conclusion = conclusion;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
    }
  }
});

test('clean and upgrade consumers require the separated supervisor build in both repetitions', () => {
  const plan = planFor([critical], 'push');
  for (const family of ['Verify clean lifecycle run', 'Verify upgrade and rollback run']) {
    for (const repetition of [1, 2]) {
      for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped']) {
        const { needs, jobs } = evidence(plan);
        const job = jobs.find((value) => value.name.endsWith(`${family} ${repetition}`));
        const step = job.steps.findIndex((value) => value.name === 'Build acceptance supervisor');
        assert.ok(step >= 0);
        if (conclusion === 'missing') job.steps.splice(step, 1);
        else job.steps[step].conclusion = conclusion;
        assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
      }
    }
  }
});

test('success consumers cannot pass with missing or unsuccessful reader preparation', () => {
  const plan = planFor([critical], 'push');
  for (const repetition of [1, 2]) {
    for (const conclusion of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = evidence(plan);
      const job = jobs.find((value) => value.name.endsWith(`workspace success run ${repetition}`));
      const step = job.steps.findIndex((value) => value.name === 'Prepare existing supervisor and proof readers once');
      assert.ok(step >= 0);
      if (conclusion === 'missing') job.steps.splice(step, 1);
      else job.steps[step].conclusion = conclusion;
      assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_REQUIRED_STEP_INCOMPLETE');
    }
  }
});

test('workflow failures, malformed plans and duplicate or extra matrix members fail closed', () => {
  const plan = planFor([critical]);
  const original = evidence(plan);
  for (const key of CI_WORKFLOWS) {
    for (const result of ['failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(original);
      needs[key].result = result;
      assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed');
    }
  }
  const { needs, jobs } = structuredClone(original);
  jobs.push({ ...jobs[0], id: 100 });
  assert.equal(evaluateCiRun(plan, needs, jobs).status, 'failed');
  jobs.at(-1).name = 'caller / Verify clean lifecycle run 2';
  assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'CI_UNEXPECTED_MATRIX_MEMBER');
  assert.equal(evaluateCiRun({ ...plan, repetitions: 0 }, needs, jobs).resultCode, 'riskPlanInvalid');
  delete needs.core;
  assert.equal(evaluateCiRun(plan, needs, jobs).resultCode, 'workflowResultsInvalid');
});

test('workflow bindings preserve one producer and exact result checks with dynamic consumer counts', async () => {
  const directory = new URL('../workflows/', import.meta.url);
  const entry = await readFile(new URL('ci-cadence-contracts.yml', directory), 'utf8');
  assert.doesNotMatch(entry.split('permissions:')[0], /paths:|branches:.*codex/);
  assert.match(entry, /needs: \[classification, cadence_contracts, core, supervisor, clean, upgrade, legacy, workspace\]/);
  for (const [owner, gate, file] of [
    ['clean', 'cleanLifecycle', 'clean'], ['upgrade', 'upgradeRollback', 'upgrade'],
    ['legacy', 'legacyUpgrade', 'legacy-diagnostic'], ['workspace', 'workspaceSuccess', 'workspace'],
  ]) {
    const block = entry.split(`\n  ${owner}:`)[1].split('\n\n')[0];
    assert.ok(block.includes(`if: fromJSON(needs.classification.outputs.plan).gates.${gate}`));
    assert.ok(block.includes('risk_plan: ${{ needs.classification.outputs.plan }}'));
    const child = await readFile(new URL(`windows-acceptance-v2-${file}.yml`, directory), 'utf8');
    assert.match(child, /workflow_call:\s+inputs:\s+risk_plan:\s+type: string\s+required: true/);
    assert.doesNotMatch(child.split('permissions:')[0], /push:|pull_request:/);
    assert.ok(child.includes("fromJSON(inputs.risk_plan).repetitions == 1 && '[1]' || '[1, 2]'"));
    assert.match(child, /artifact-ids: \$\{\{ needs\.[a-z_]+\.outputs\.artifact_id \}\}/);
  }
  const core = await readFile(new URL('ci.yml', directory), 'utf8');
  const contracts = core.split('\n  windows-contracts:')[1];
  assert.match(core, /workflow_call:\s+inputs:\s+risk_plan:\s+required: true\s+type: string/);
  assert.doesNotMatch(core.split('permissions:')[0], /push:|pull_request:/);
  assert.doesNotMatch(core, /installer-windows:|installer-w6b|installer:w6b|installer:upgrade/);
  assert.match(contracts, /persist-credentials: false\s+fetch-depth: 0/);
  assert.match(contracts, /Run deterministic installer tests/);
  assert.match(contracts, /Run deterministic MSI file-policy contracts\s+run: pnpm --filter @eky\/desktop installer:test:msi-file-policy/);
  assert.match(contracts, /Verify synthetic MSI UI and file-version policy\s+run: node apps\/desktop\/installer\/windows-acceptance-harness\/fixtures\/runMsiFileVersionPolicyProbe\.mjs/);
});

test('MSI file policy has a hosted-only manual path without replacing supervisor acceptance', async () => {
  const source = await readFile(new URL('../workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const policy = source.split('\n  msi-file-version-policy:')[1]?.split('\n  job-object-feasibility:')[0];
  assert.ok(policy);
  assert.match(policy, /if: github.event_name == 'workflow_dispatch' && inputs.mode == 'msi-file-version-policy'/);
  assert.match(policy, /runs-on: windows-latest/);
  assert.match(policy, /ref: \$\{\{ github.sha \}\}/);
  assert.match(policy, /persist-credentials: false/);
  assert.match(policy, /node installer\/windows-process-supervisor\/buildWindowsAcceptanceSupervisor\.mjs/);
  assert.match(policy, /node installer\/windows-acceptance-harness\/fixtures\/runMsiFileVersionPolicyProbe\.mjs/);
  assert.doesNotMatch(policy, /upload-artifact|continue-on-error|--prepare-only/);
  assert.match(source, /job-object-feasibility:\n    if: inputs.mode != 'packaged-boundary-diagnostic' && inputs.mode != 'msi-file-version-policy'/);
});

test('synthetic evidence proof selects exactly one manual job and preserves reusable supervisor acceptance', async () => {
  const source = await readFile(new URL('../workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const modes = ['encrypted-evidence-delivery-proof', 'linux-encrypted-evidence-delivery-proof'];
  const conditions = [...source.matchAll(/^  ([\w-]+):\n    if: ([^\n]+)/gm)];
  const selected = (eventName, mode) => conditions.filter(([, , expression]) => runInNewContext(expression,
    { github: { event_name: eventName }, inputs: { mode } }, { timeout: 1000 })).map(([, name]) => name);
  assert.equal(conditions.length, 6);
  for (const mode of modes) {
    assert.deepEqual(selected('workflow_dispatch', mode), [mode]);
    for (const eventName of ['pull_request', 'pull_request_target', 'push', 'schedule', 'workflow_call', 'workflow_run']) {
      assert.deepEqual(selected(eventName, mode), []);
      assert.deepEqual(selected(eventName, undefined), ['job-object-feasibility']);
    }
  }
  assert.deepEqual(selected('workflow_dispatch', 'contracts'), ['job-object-feasibility']);
  for (const other of ['inspector-cutoff-diagnostic', 'msi-file-version-policy', 'packaged-boundary-diagnostic']) {
    assert.deepEqual(selected('workflow_dispatch', other), [other]);
  }
  assert.match(source, /default: contracts/);
  assert.match(source, /workflow_call:\n  workflow_dispatch:/);
  const group = source.match(/group: windows-acceptance-supervisor-[^\n]+\$\{\{ ([^\n]+) \}\}/)?.[1];
  assert.ok(group);
  const suffix = (mode, artifact_kind) => runInNewContext(group, { inputs: { mode, artifact_kind } }, { timeout: 1000 });
  for (const mode of modes) assert.equal(suffix(mode), mode);
  assert.equal(suffix('contracts'), '');
  assert.equal(suffix(undefined), '');
  assert.equal(suffix('packaged-boundary-diagnostic', 'workspace'), 'workspace');
  const normal = source.split('  job-object-feasibility:')[1].split('  packaged-boundary-diagnostic:')[0];
  assert.match(normal, /format\('Windows Job Object feasibility run \{0\}', matrix.repetition\)/);
  assert.match(normal, /'\[1\]' \|\| '\[1, 2\]'/);
});

test('synthetic evidence proof uses pinned tools and required encrypted-only publication without builds', async () => {
  const source = await readFile(new URL('../workflows/windows-acceptance-supervisor-feasibility.yml', import.meta.url), 'utf8');
  const job = source.split('  encrypted-evidence-delivery-proof:')[1].split('  inspector-cutoff-diagnostic:')[0];
  const blocks = job.split('      - name:');
  const step = name => {
    const result = blocks.find(value => value.startsWith(' ' + name + '\n'));
    assert.ok(result, name);
    return result;
  };
  assert.match(job, /runs-on: windows-latest/);
  assert.match(job, /timeout-minutes: 5/);
  assert.match(job, /ref: \$\{\{ github.sha \}\}/);
  assert.match(job, /persist-credentials: false/);
  const probe = step('Produce one verified synthetic first failure');
  assert.equal(blocks.filter(value => value.startsWith(' Produce one verified synthetic first failure\n')).length, 1);
  assert.match(probe, /^        id: failure_probe$/m);
  assert.match(probe, /^        working-directory: \.$/m);
  assert.match(probe, /^        run: node \.github\/scripts\/ciFailureEvidenceProbe\.mjs$/m);
  assert.deepEqual(probe.match(/^        continue-on-error: .+$/gm), ['        continue-on-error: true']);
  const requiredJob = job.replace(probe, probe.replace(/^        continue-on-error: true\r?\n/m, ''));
  assert.doesNotMatch(requiredJob, /needs:|matrix:|continue-on-error|\b(?:pnpm|npm|msiexec|dotnet|wpr)\b|setup-dotnet|buildWindows|captureInstaller|download-artifact/);
  const delivery = step('Deliver synthetic first failure through the normal collector');
  assert.match(delivery, /^        uses: \.\/\.github\/actions\/collect-ci-failure-evidence$/m);
  assert.equal(delivery.match(/^        if: (.+)$/m)?.[1],
    "${{ always() && steps.failure_probe.outcome == 'failure' && steps.failure_probe.outputs.probe_verified == 'true' }}");
  const terminal = step('Require verified first failure and encrypted publication');
  assert.match(terminal, /^        if: always\(\)$/m);
  for (const [variable, expected] of [['PROBE_OUTCOME', 'failure'], ['PROBE_VERIFIED', 'true'],
    ['DELIVERY_OUTCOME', 'success'], ['SEALED', 'true'], ['UPLOAD_OUTCOME', 'success']]) {
    assert.ok(terminal.includes(`$env:${variable} -cne '${expected}'`));
  }
  assert.ok(terminal.includes("$env:ARTIFACT_ID -cnotmatch '^[1-9][0-9]*$'"));
  assert.match(terminal, /CI_FIRST_FAILURE_EVIDENCE_DELIVERY_UNVERIFIED'\)\n\s+exit 1/);
  assert.deepEqual([...job.matchAll(/uses: ([^\s]+)/g)].map(([, action]) => action), [
    'actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1',
    'actions/setup-node@820762786026740c76f36085b0efc47a31fe5020',
    'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a',
    './.github/actions/collect-ci-failure-evidence',
  ]);
  assert.match(step('Set up pinned Node.js'), /node-version-file: eky_software\/\.node-version/);
  assert.match(step('Set up pinned Node.js'), /package-manager-cache: false/);
  const tools = step('Verify pinned Node and provisioned Git GnuPG');
  assert.match(tools, /\$actual -cne "v\$expected"/);
  assert.match(tools, /\.node-version/);
  for (const executable of ['node', 'git']) {
    assert.ok(tools.includes(`Get-Command ${executable}.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1`));
  }
  assert.match(tools, /\.\.\/usr\/bin\/gpg.exe/);
  assert.match(tools, /\. \.\/apps\/desktop\/installer\/windows-acceptance-harness\/encryptedEvidenceOpenPgp.ps1/);
  assert.match(tools, /IsPathFullyQualified\(\$env:RUNNER_TEMP\)/);
  assert.match(tools, /Join-Path \$env:RUNNER_TEMP \('eky-delivery-preflight-' \+ \[Guid\]::NewGuid\(\)/);
  assert.match(tools, /Test-Path -LiteralPath \$homePath/);
  assert.match(tools, /\[void\]\[IO.Directory\]::CreateDirectory\(\$homePath\)/);
  assert.match(tools, /Invoke-EvidenceGpgProcess -Executable \$node -Arguments @\('--version'\)/);
  assert.match(tools, /Invoke-EvidenceGpgProcess -Executable \$gpg -Arguments \$arguments/);
  assert.match(tools, /'--homedir', \(ConvertTo-EvidenceGpgPath \$homePath\)/);
  for (const option of ['--no-options', '--no-keyring', '--batch', '--no-tty', '--no-autostart', '--disable-dirmngr', '--version']) {
    assert.ok(tools.includes(`'${option}'`));
  }
  assert.equal([...tools.matchAll(/-HomePath \$homePath -ErrorPath \(Join-Path \$homePath '(?:node|gpg)\.stderr\.private\.log'\) -TimeoutMilliseconds 10000 -TotalBudgetMilliseconds 10000/g)].length, 2);
  for (const capability of ['AES256', 'RSA', 'ECDH', 'EDDSA']) assert.ok(tools.includes(capability));
  assert.doesNotMatch(tools, /& \$(?:node|gpg)|Invoke-WebRequest|Invoke-RestMethod|winget|choco|Write-Host|Write-Output/);
  assert.match(tools, /\[Console\]::Error.WriteLine\('WORKSPACE_ENCRYPTED_EVIDENCE_TOOLS_UNVERIFIED'\)/);
  assert.match(tools, /exit 1/);
  const seal = step('Seal one synthetic delivery proof');
  assert.match(seal, /EKY_EVIDENCE_DELIVERY_PROOF: '1'/);
  for (const name of ['PUBLIC_KEY', 'KEY_FINGERPRINT', 'VERIFIED_FINGERPRINT']) {
    assert.ok(seal.includes(`EKY_DIAGNOSTIC_${name}: \${{ vars.EKY_DIAGNOSTIC_${name} }}`));
  }
  assert.match(seal, /workspaceEncryptedEvidence.mjs delivery-proof/);
  assert.doesNotMatch(seal, /if:|EXPECTED_DESCRIPTOR|EXPECTED_BUILD_REVISION/);
  const upload = step('Upload encrypted delivery proof only');
  const expression = upload.match(/if: (.+)/)?.[1];
  for (const succeeded of [false, true]) {
    for (const outcome of ['success', 'failure', 'cancelled', 'skipped']) {
      for (const sealed of ['', 'false', 'true']) {
        assert.equal(runInNewContext(expression, { success: () => succeeded,
          steps: { evidence_seal: { outcome, outputs: { sealed } } } }, { timeout: 1000 }),
        succeeded && outcome === 'success' && sealed === 'true');
      }
    }
  }
  assert.match(upload, /path: \$\{\{ steps.evidence_seal.outputs.ciphertext \}\}/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /retention-days: 1/);
  assert.match(upload, /overwrite: false/);
  assert.match(upload, /include-hidden-files: false/);
  assert.doesNotMatch(upload, /\.etl|\.log|\.private|\*|recipient/);
  const required = step('Require encrypted delivery publication');
  assert.match(required, /if: always\(\)/);
  assert.match(required, /UPLOAD_OUTCOME: \$\{\{ steps.evidence_upload.outcome \}\}/);
  assert.match(required, /ARTIFACT_ID: \$\{\{ steps.evidence_upload.outputs.artifact-id \}\}/);
  assert.match(required, /\$env:UPLOAD_OUTCOME -cne 'success'/);
  assert.match(required, /\$env:SEALED -cne 'true'/);
  assert.match(required, /exit 1/);
  const cadence = await readFile(new URL('../workflows/ci-cadence-contracts.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(cadence, /encrypted-evidence-delivery-proof/);
});

test('manual diagnostics select independent existing jobs without changing reusable core gates', async () => {
  const core = await readFile(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  const dispatch = core.split('  workflow_dispatch:\n')[1]?.split('  workflow_call:\n')[0];
  assert.ok(dispatch);
  assert.match(dispatch, /electron_diagnostic:\n        description: [^\n]+\n        required: true\n        type: boolean\n        default: true/u);
  assert.match(dispatch, /linux_consumer_diagnostic:\n        description: [^\n]+\n        required: true\n        type: boolean\n        default: false/u);
  assert.doesNotMatch(core.split('  workflow_call:\n')[1].split('permissions:')[0], /linux_consumer_diagnostic/u);
  const cadence = await readFile(new URL('../workflows/ci-cadence-contracts.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(cadence, /linux_consumer_diagnostic/u);
  const conditions = [...core.matchAll(/^  ([\w-]+):\n    name: [^\n]+\n    if: ([^\n]+)/gm)];
  assert.equal(conditions.length, 5);
  const selected = (inputs) => conditions.filter(([, , expression]) => runInNewContext(
    expression, { inputs, fromJSON: JSON.parse }, { timeout: 1000 },
  )).map(([, name]) => name);
  const base = ['verify', 'e2e-system-security', 'e2e-web-critical'];
  for (const eventName of ['pull_request', 'push', 'schedule', 'workflow_dispatch']) {
    for (const changed of [fast, critical]) {
      const plan = planFor([changed], eventName);
      for (const electron of [undefined, false, true]) {
        for (const linux of [undefined, false, true]) {
          assert.deepEqual(selected({ risk_plan: JSON.stringify(plan),
            electron_diagnostic: electron, linux_consumer_diagnostic: linux }), [...base,
            ...(plan.gates.electronCritical ? ['e2e-electron-windows-critical'] : []),
            ...(plan.gates.windowsContracts ? ['windows-contracts'] : []),
          ]);
        }
      }
    }
  }
  assert.deepEqual(selected({ risk_plan: '', electron_diagnostic: true }), ['e2e-electron-windows-critical']);
  for (const electron of [false, true]) {
    for (const linux of [undefined, false, true]) {
      assert.deepEqual(selected({ risk_plan: '', electron_diagnostic: electron,
        linux_consumer_diagnostic: linux }), [
        ...(linux === true ? ['e2e-system-security', 'e2e-web-critical'] : []),
        ...(electron ? ['e2e-electron-windows-critical'] : []),
      ]);
      assert.throws(() => selected({ risk_plan: 'invalid', electron_diagnostic: electron,
        linux_consumer_diagnostic: linux }));
    }
  }
  const plan = planFor([fast]);
  assert.deepEqual(selected({ risk_plan: JSON.stringify(plan), electron_diagnostic: true }), base);
  assert.doesNotMatch(core, /name: V2 acceptance|uses: .*windows-acceptance/);
  assert.match(core, /name: Verify Electron startup observation wiring\s+if: inputs.risk_plan == '' && inputs.electron_diagnostic\s+run: pnpm --filter @eky\/e2e exec playwright test --project=electron-development --grep @diagnostic-contract --workers=1 --retries=0/);
});

const linuxConsumers = [
  { job: 'e2e-system-security', scope: 'system', consumer: 'system-api', timeout: 10,
    normal: 'Run isolated system security E2E tests' },
  { job: 'e2e-web-critical', scope: 'web', consumer: 'web-chromium', timeout: 15,
    normal: 'Run critical web E2E journeys' },
];

function linuxDiagnosticSteps({ scope }) {
  return [
    `Build ${scope} Linux consumer diagnostic`,
    `Run ${scope} Linux consumer loss diagnostic`,
    ...(scope === 'web' ? ['Run Linux consumer endurance baseline'] : []),
  ];
}

function workflowJob(source, name) {
  const section = source.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/u)[0];
  assert.ok(section, 'JOB_MISSING');
  return section;
}

function workflowStep(source, name) {
  const section = source.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0];
  assert.ok(section, 'STEP_MISSING');
  return section.trimEnd();
}

function verifyLinuxDiagnostics(source, definition) {
  const section = workflowJob(source, definition.job);
  assert.match(section, /if: inputs\.risk_plan != '' \|\| \(inputs\.risk_plan == '' && inputs\.linux_consumer_diagnostic == true\)\n    runs-on: ubuntu-latest/u);
  assert.match(section, new RegExp(`    timeout-minutes: ${definition.timeout}\\n`, 'u'));
  assert.match(section, /working-directory: eky_software/u);
  const required = withoutOptionalEvidenceAllowance(section, 1, false, 'Linux')
    .split(/(?=^      - name: )/mu)
    .filter(step => !step.startsWith('      - name: Preserve encrypted CI failure evidence\n')).join('');
  assert.doesNotMatch(required, /continue-on-error:|upload-artifact|always\(\)/u);
  const normal = workflowStep(section, definition.normal);
  assert.doesNotMatch(normal, /if:|linux:consumer|test:e2e:stress|success\(\)/u);
  let previous = section.indexOf(`      - name: ${definition.normal}\n`);
  const steps = linuxDiagnosticSteps(definition);
  const runs = [
    '        run: pnpm --filter @eky/e2e linux:consumer:build',
    [
      '        run: |',
      '          checkout_sha="$(git rev-parse --verify HEAD 2>/dev/null)" || checkout_sha=""',
      `          pnpm --filter @eky/e2e linux:consumer:loss --scope=${definition.scope} --consumer=${definition.consumer} --checkout-sha="$checkout_sha"`,
    ].join('\n'),
    ...(definition.scope === 'web' ? ['        run: pnpm test:e2e:stress'] : []),
  ];
  for (const [index, name] of steps.entries()) {
    const position = section.indexOf(`      - name: ${name}\n`);
    assert.ok(position > previous, 'DIAGNOSTIC_ORDER');
    previous = position;
    assert.equal(workflowStep(section, name), [
      "        if: success() && inputs.risk_plan == '' && inputs.linux_consumer_diagnostic == true",
      '        env:',
      "          EKY_E2E: '1'",
      runs[index],
    ].join('\n'));
  }
  return section;
}

test('manual Linux consumer diagnostics bind source and preserve normal steps, budgets and stress separation', async () => {
  const core = await readFile(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  for (const definition of linuxConsumers) verifyLinuxDiagnostics(core, definition);
  assert.equal(core.match(/run: pnpm --filter @eky\/e2e linux:consumer:build/gu)?.length, 2);
  assert.equal(core.match(/pnpm --filter @eky\/e2e linux:consumer:loss /gu)?.length, 2);
  assert.equal(core.match(/run: pnpm test:e2e:stress/gu)?.length, 1);
  for (const name of ['verify', 'e2e-electron-windows-critical', 'windows-contracts']) {
    assert.doesNotMatch(workflowJob(core, name), /linux:consumer|test:e2e:stress|linux_consumer_diagnostic/u);
  }
  const root = JSON.parse(await readFile(new URL('../../eky_software/package.json', import.meta.url), 'utf8'));
  const e2e = JSON.parse(await readFile(new URL('../../eky_software/apps/e2e/package.json', import.meta.url), 'utf8'));
  assert.equal(root.scripts['test:e2e:stress'], 'pnpm --filter @eky/e2e e2e:stress');
  assert.equal(root.scripts['test:e2e:all'], 'pnpm --filter @eky/e2e e2e:all');
  assert.equal(e2e.scripts['e2e:stress'], 'pnpm e2e:prepare && playwright test --project=endurance-baseline');
  assert.equal(e2e.scripts['e2e:all'], 'pnpm e2e:electron:prepare && playwright test --project=system-api --project=web-chromium --project=electron-development');
});

test('every manual Linux diagnostic step requires successful predecessors and an empty risk plan', async () => {
  const core = await readFile(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  for (const definition of linuxConsumers) {
    const section = verifyLinuxDiagnostics(core, definition);
    for (const name of linuxDiagnosticSteps(definition)) {
      const expression = workflowStep(section, name).split('\n')[0].trim().slice('if: '.length);
      for (const successful of [false, true]) {
        for (const riskPlan of ['', JSON.stringify(planFor([fast])), 'invalid']) {
          for (const enabled of [undefined, false, true]) {
            assert.equal(runInNewContext(expression, { success: () => successful,
              inputs: { risk_plan: riskPlan, linux_consumer_diagnostic: enabled },
            }, { timeout: 1000 }), successful && riskPlan === '' && enabled === true);
          }
        }
      }
    }
  }
});

test('Linux diagnostic wiring rejects ungated, unbound, reordered and swallowed-status mutations', async () => {
  const core = await readFile(new URL('../workflows/ci.yml', import.meta.url), 'utf8');
  for (const definition of linuxConsumers) {
    const section = verifyLinuxDiagnostics(core, definition);
    const steps = linuxDiagnosticSteps(definition);
    for (const name of steps) {
      const original = workflowStep(section, name);
      for (const changed of [
        original.replace('success() && ', ''),
        original.replace("inputs.risk_plan == '' && ", ''),
        original.replace('inputs.linux_consumer_diagnostic == true', 'true'),
        original.replace("EKY_E2E: '1'", "EKY_E2E: '0'"),
        `${original} || true`,
        `${original}\n        continue-on-error: true`,
        `${original}\n        timeout-minutes: 15`,
        `${original}\n          exit 0`,
      ]) assert.throws(() => verifyLinuxDiagnostics(core.replace(section,
        section.replace(original, changed)), definition));
      assert.throws(() => verifyLinuxDiagnostics(core.replace(name, 'Missing diagnostic'), definition));
    }
    const loss = workflowStep(section, steps[1]);
    for (const changed of [
      loss.replace('--checkout-sha="$checkout_sha"', '--checkout-sha=HEAD'),
      loss.replace('--verify HEAD', '--verify origin/main'),
      loss.replace(`--scope=${definition.scope}`, '--scope=all'),
      loss.replace(`--consumer=${definition.consumer}`, '--consumer=electron-development'),
      loss.replace(`--scope=${definition.scope} --consumer=${definition.consumer}`,
        `--consumer=${definition.consumer} --scope=${definition.scope}`),
      `${loss} 2>/dev/null`,
    ]) assert.throws(() => verifyLinuxDiagnostics(core.replace(loss, changed), definition));
    const [first, second] = steps;
    const swapped = section.replace(`name: ${first}`, 'name: swapped')
      .replace(`name: ${second}`, `name: ${first}`).replace('name: swapped', `name: ${second}`);
    assert.throws(() => verifyLinuxDiagnostics(core.replace(section, swapped), definition));
    assert.throws(() => verifyLinuxDiagnostics(core.replace(section,
      section.replace(`timeout-minutes: ${definition.timeout}`, 'timeout-minutes: 60')), definition));
  }
});
