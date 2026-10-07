import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { withoutOptionalEvidenceAllowance } from './ciFailureEvidenceTestContract.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const actionPath = '.github/actions/collect-ci-failure-evidence/action.yml';
const collectorPath = 'eky_software/apps/desktop/installer/windows-acceptance-harness/ciFailureEvidence.mjs';
const action = read('../actions/collect-ci-failure-evidence/action.yml');
const actionUse = './.github/actions/collect-ci-failure-evidence';
const hookName = 'Preserve encrypted CI failure evidence';
const uploadPin = 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a';

// This is delivery coverage, not a claim that every command produces private raw data.
// In particular, dependency preparation retains its existing safe console evidence only.
const normalFamilies = {
  'ci.yml': {
    verify: 'core-verify',
    'e2e-system-security': 'core-system',
    'e2e-web-critical': 'core-web',
    'e2e-electron-windows-critical': 'core-electron',
    'windows-contracts': 'core-installer',
  },
  'ci-cadence-contracts.yml': { cadence_contracts: 'cadence-contracts' },
  'windows-acceptance-supervisor-feasibility.yml': { 'job-object-feasibility': 'supervisor-contracts' },
  'windows-acceptance-v2-clean.yml': {
    artifact_producer: 'clean-producer', clean_consumer: 'clean-consumer',
  },
  'windows-acceptance-v2-upgrade.yml': {
    upgrade_artifact_producer: 'upgrade-producer', upgrade_consumer: 'upgrade-consumer',
  },
  'windows-acceptance-v2-legacy-diagnostic.yml': {
    legacy_contracts: 'legacy-contracts', legacy_artifact_producer: 'legacy-producer',
    legacy_consumer: 'legacy-consumer',
  },
  'windows-acceptance-v2-workspace.yml': {
    workspace_artifact_contracts: 'workspace-contracts', workspace_artifact_producer: 'workspace-producer',
    workspace_consumer: 'workspace-success', workspace_fault_consumer: 'workspace-fault',
  },
};
const exclusions = {
  'ci-cadence-contracts.yml': {
    classification: 'Linux risk classification only; existing public safe console',
    acceptance: 'Linux result aggregation only; existing public safe console',
    core: 'Reusable call; capture belongs to its concrete Linux and Windows jobs',
    supervisor: 'Reusable call; capture belongs to its concrete Windows jobs',
    clean: 'Reusable call; capture belongs to its concrete Windows jobs',
    upgrade: 'Reusable call; capture belongs to its concrete Windows jobs',
    legacy: 'Reusable call; capture belongs to its concrete Windows jobs',
    workspace: 'Reusable call; capture belongs to its concrete Windows jobs',
  },
  'dependency-security.yml': { audit: 'Linux dependency audit; safe console only, tool raw output excluded' },
  'windows-acceptance-supervisor-feasibility.yml': {
    'encrypted-evidence-delivery-proof': 'Explicit diagnostic experiment with its own delivery contract',
    'linux-encrypted-evidence-delivery-proof': 'Explicit Linux experiment with its own delivery contract',
    'inspector-cutoff-diagnostic': 'Explicit experiment, not normal required acceptance',
    'msi-file-version-policy': 'Explicit experiment, not normal required acceptance',
  },
};
const diagnosticFamilies = {
  'windows-acceptance-supervisor-feasibility.yml': ['packaged-boundary-diagnostic'],
};

function platformsFor(key) {
  if (key === 'cadence-contracts') return ['Windows', 'Linux'];
  return [['core-verify', 'core-system', 'core-web'].includes(key) ? 'Linux' : 'Windows'];
}

// Match the repository's existing named-job/named-step layout. A layout change must
// update this contract explicitly; this helper is not a general YAML parser.
function jobs(source) {
  const body = source.split('\njobs:\n')[1];
  assert.ok(body, 'workflow must declare jobs');
  return new Map(body.split(/(?=^  [\w-]+:\s*$)/mu).filter(block => block.trim()).map(block => {
    const match = /^  ([\w-]+):\s*\n/u.exec(block);
    assert.ok(match, 'unrecognized job layout');
    return [match[1], block];
  }));
}

function steps(block, indentation) {
  return block.split(new RegExp(`(?=^${' '.repeat(indentation)}- name: )`, 'mu')).slice(1);
}

function condition(step, indentation) {
  const match = new RegExp(`^${' '.repeat(indentation)}if: >-\\n((?:${' '.repeat(indentation + 2)}[^\\n]+\\n)+)`, 'mu').exec(step);
  assert.ok(match, 'expected explicit folded condition');
  return match[1].trim().replace(/^\$\{\{\s*|\s*\}\}$/gu, '');
}

function context(runnerOs = 'Windows') {
  const fingerprint = 'A'.repeat(40);
  return {
    always: () => true,
    hashFiles: path => [actionPath, collectorPath].includes(path) ? 'present' : '',
    runner: { os: runnerOs, environment: 'github-hosted' },
    job: { status: 'failure' },
    github: { event_name: 'pull_request', repository: 'example/erp',
      event: { pull_request: { head: { repo: { full_name: 'example/erp' } } } } },
    vars: { EKY_DIAGNOSTIC_PUBLIC_KEY: 'synthetic-public-key', EKY_DIAGNOSTIC_KEY_FINGERPRINT: fingerprint,
      EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT: fingerprint },
    inputs: { mode: '', 'job-outcome': 'failure', 'public-key': 'synthetic-public-key',
      fingerprint, 'verified-fingerprint': fingerprint },
  };
}

function evaluate(expression, mutate = () => {}, runnerOs = 'Windows') {
  const values = context(runnerOs);
  mutate(values);
  // All compared values are fixed strings; this exercises the boolean gate,
  // not GitHub's general expression coercion rules.
  const script = expression.replace(/inputs\.([a-z][a-z_-]*)/gu, 'inputs["$1"]');
  return Boolean(runInNewContext(script, values, { timeout: 1000 }));
}

const workflowFiles = readdirSync(new URL('../workflows/', import.meta.url)).filter(name => /\.ya?ml$/u.test(name));
const workflows = new Map(workflowFiles.map(file => [file, jobs(read(`../workflows/${file}`))]));

// Previously approved opt-in diagnostics retain their exact guards. This is not
// a general exception for steps containing words such as "capture" or "evidence".
const existingOptionalGuards = {
  'windows-acceptance-v2-legacy-diagnostic.yml/legacy_consumer': {
    'Start optional bounded inspector capture': "env.LEGACY_CAPTURE_ENABLED == 'true'",
    'Stop optional bounded inspector capture': "${{ always() && env.LEGACY_CAPTURE_ENABLED == 'true' && (steps.capture_start.outcome == 'success' || steps.capture_start.outcome == 'failure' || steps.capture_start.outcome == 'cancelled') }}",
    'Analyze and report optional inspector capture': "${{ always() && env.LEGACY_CAPTURE_ENABLED == 'true' && steps.capture_start.outcome != 'skipped' }}",
  },
  'windows-acceptance-v2-workspace.yml/workspace_consumer': {
    'Prepare optional encrypted workspace evidence': "${{ vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT != '' && (github.event_name != 'pull_request' || github.event.pull_request.head.repo.full_name == github.repository) }}",
    'Start optional workspace evidence capture': "${{ steps.evidence_prepare.outcome == 'success' }}",
    'Stop optional workspace evidence capture': "${{ always() && steps.evidence_prepare.outcome == 'success' && steps.evidence_start.outcome != 'skipped' }}",
    'Seal workspace evidence before publication': "${{ always() && steps.evidence_prepare.outcome == 'success' }}",
    'Upload encrypted workspace evidence only': "${{ always() && steps.evidence_seal.outcome == 'success' && steps.evidence_seal.outputs.sealed == 'true' }}",
  },
};

function assertMandatoryFailurePolicy(job, key) {
  const allowed = existingOptionalGuards[key] ?? {};
  const [file, id] = key.split('/');
  const platforms = platformsFor(normalFamilies[file][id]);
  assert.doesNotMatch(job.split('\n    steps:\n')[0], /continue-on-error:/u, `${key}: job remains mandatory`);
  for (const step of steps(job, 6)) {
    const name = step.split('\n')[0].slice('      - name: '.length);
    if (name === hookName) {
      withoutOptionalEvidenceAllowance(step, 1,
        key === 'windows-acceptance-supervisor-feasibility.yml/job-object-feasibility', platforms.join('/'));
      assert.match(step, /^        uses: \.\/\.github\/actions\/collect-ci-failure-evidence$/mu);
      const gate = condition(step, 8);
      assert.ok(evaluate(gate, undefined, platforms[0]));
      for (const mutate of [
        c => { c.job.status = 'success'; },
        c => { c.runner.os = 'macOS'; },
        c => { c.runner.environment = 'self-hosted'; },
        c => { c.github.event.pull_request.head.repo.full_name = 'outside/fork'; },
        c => { c.vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT = ''; },
      ]) assert.equal(evaluate(gate, mutate, platforms[0]), false);
    } else if (Object.hasOwn(allowed, name)) {
      assert.equal(step.match(/^        if: (.+)$/mu)?.[1], allowed[name]);
    } else {
      assert.doesNotMatch(step, /continue-on-error:/u, `${key}/${name}: required step`);
      continue;
    }
    assert.deepEqual(step.match(/^        continue-on-error: .+$/gmu), ['        continue-on-error: true']);
  }
}

test('diagnostic allowances never weaken mandatory jobs or preparation and test steps', () => {
  for (const [file, family] of Object.entries(normalFamilies)) {
    for (const id of Object.keys(family)) assertMandatoryFailurePolicy(workflows.get(file).get(id), `${file}/${id}`);
  }
  const key = 'windows-acceptance-v2-clean.yml/clean_consumer';
  const original = workflows.get('windows-acceptance-v2-clean.yml').get('clean_consumer');
  for (const changed of [
    original.replace('  clean_consumer:\n', '  clean_consumer:\n    continue-on-error: true\n'),
    original.replace('      - name: Install dependencies\n', '      - name: Install dependencies\n        continue-on-error: true\n'),
    original.replace('      - name: Run supervised clean lifecycle once\n', '      - name: Run supervised clean lifecycle once\n        continue-on-error: true\n'),
    original.replace("job.status == 'failure'", "job.status == 'success'"),
    original.replace("always() && runner.os == 'Windows'", "always() || runner.os == 'Windows'"),
    original.replace(`uses: ${actionUse}`, 'uses: ./.github/actions/other'),
  ]) {
    assert.notEqual(changed, original);
    assert.throws(() => assertMandatoryFailurePolicy(changed, key));
  }
});

test('shared optional projection rejects changed guards, duplicate fields and hidden mandatory allowances', () => {
  const original = workflows.get('windows-acceptance-v2-clean.yml').get('clean_consumer');
  const projected = withoutOptionalEvidenceAllowance(original, 1);
  assert.equal(projected, original.replace(/^        continue-on-error: true\r?\n/mu, ''));
  assert.throws(() => withoutOptionalEvidenceAllowance(original, 0));
  const hook = steps(original, 6).at(-1);
  for (const changedHook of [
    hook.replace("runner.os == 'Windows'", "runner.os == 'Linux'"),
    hook.replace('always() &&', 'always() ||'),
    hook.replace('timeout-minutes: 3', 'timeout-minutes: 4'),
    hook.replace('        timeout-minutes: 3', '        timeout-minutes: 3\n        timeout-minutes: 4'),
    hook.replace(`        uses: ${actionUse}`, `        uses: ${actionUse}\n        uses: ./other`),
    hook.replace('        if: >-', '        if: true\n        if: >-'),
    hook.replace('        continue-on-error: true', '        continue-on-error: true\n        continue-on-error: false'),
    `${hook}\n        run: echo unexpected\n`,
    `${hook}\n        env:\n          UNEXPECTED: true\n`,
  ]) assert.throws(() => withoutOptionalEvidenceAllowance(original.replace(hook, changedHook), 1));
  const withMandatoryAllowance = original.replace('      - name: Install dependencies\n',
    '      - name: Install dependencies\n        continue-on-error: true\n');
  assert.match(withoutOptionalEvidenceAllowance(withMandatoryAllowance, 1),
    /- name: Install dependencies\n        continue-on-error: true/u);
});

test('Linux and mixed-platform hooks reject weakened trust, failure and mandatory-step policies', () => {
  for (const [file, id] of [['ci.yml', 'verify'], ['ci.yml', 'e2e-system-security'],
    ['ci.yml', 'e2e-web-critical'], ['ci-cadence-contracts.yml', 'cadence_contracts']]) {
    const original = workflows.get(file).get(id);
    for (const changed of [
      original.replace('always() &&', 'always() ||'),
      original.replace("runner.environment == 'github-hosted'", 'true'),
      original.replace("job.status == 'failure'", "job.status == 'success'"),
      original.replace('github.event.pull_request.head.repo.full_name == github.repository', 'true'),
      original.replace("github.event_name == 'push'", "github.event_name == 'pull_request_target'"),
      original.replace('vars.EKY_DIAGNOSTIC_KEY_FINGERPRINT == vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT', 'true'),
      original.replace('        timeout-minutes: 3', '        timeout-minutes: 4'),
      original.replace('      - name: Set up Node.js\n', '      - name: Set up Node.js\n        continue-on-error: true\n'),
    ]) {
      assert.notEqual(changed, original);
      assert.throws(() => assertMandatoryFailurePolicy(changed, `${file}/${id}`));
    }
  }
});

test('every current CI job has an explicit failure-delivery or exclusion decision', () => {
  assert.deepEqual([...workflows.keys()].sort(), [...new Set([...Object.keys(normalFamilies), ...Object.keys(exclusions)])].sort());
  for (const [file, jobMap] of workflows) {
    const covered = normalFamilies[file] ?? {};
    const excluded = exclusions[file] ?? {};
    const diagnostic = diagnosticFamilies[file] ?? [];
    assert.deepEqual([...jobMap.keys()].sort(), [...Object.keys(covered), ...Object.keys(excluded), ...diagnostic].sort(), file);
    for (const [id, reason] of Object.entries(excluded)) {
      assert.ok(reason.length > 20, `${file}/${id}: exclusion needs a rationale`);
      if (!['encrypted-evidence-delivery-proof', 'linux-encrypted-evidence-delivery-proof'].includes(id)) {
        assert.ok(!jobMap.get(id).includes(actionUse), `${file}/${id}: excluded job cannot seal`);
      }
    }
  }
});

test('legacy packaged diagnostic uses the existing failure collector last without changing mandatory steps', () => {
  const job = workflows.get('windows-acceptance-supervisor-feasibility.yml').get('packaged-boundary-diagnostic');
  const allSteps = steps(job, 6);
  const hook = allSteps.at(-1);
  assert.equal(allSteps.filter(step => step.includes(`uses: ${actionUse}\n`)).length, 1);
  assert.ok(hook.startsWith(`      - name: ${hookName}\n`));
  assert.ok(hook.includes('          job-key: legacy-boundary-diagnostic-0\n'));
  assert.ok(hook.includes('          job-outcome: ${{ job.status }}\n'));
  assert.match(job.split('\n    steps:\n')[0], /github\.event_name == 'workflow_dispatch' && inputs\.mode == 'packaged-boundary-diagnostic'/u);
  const scope = "            && inputs.artifact_kind == 'legacy'\n";
  assert.equal(hook.split(scope).length, 2);
  withoutOptionalEvidenceAllowance(hook.replace(scope, ''), 1);
  const gate = condition(hook, 8);
  const legacyContext = c => { c.github.event_name = 'workflow_dispatch'; c.inputs.artifact_kind = 'legacy'; };
  assert.ok(evaluate(gate, legacyContext));
  for (const mutate of [
    c => { c.inputs.artifact_kind = 'workspace'; },
    c => { c.inputs.artifact_kind = 'upgrade'; },
    c => { c.job.status = 'success'; },
    c => { c.runner.os = 'Linux'; },
    c => { c.runner.environment = 'self-hosted'; },
    c => { c.vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT = ''; },
    c => { c.github.event_name = 'pull_request_target'; },
  ]) assert.equal(evaluate(gate, c => { legacyContext(c); mutate(c); }), false);
  const mandatory = allSteps.find(step => step.includes('- name: Run existing caller and mandatory result verifier once\n'));
  assert.ok(mandatory);
  assert.doesNotMatch(mandatory, /continue-on-error:/u);
  assert.match(mandatory, /WINDOWS_ACCEPTANCE_DIAGNOSTIC_CALLER_FAILED/u);
});

test('all normal Linux and Windows families collect last, independently of which preparation or test failed', () => {
  let count = 0;
  for (const [file, family] of Object.entries(normalFamilies)) {
    for (const [id, key] of Object.entries(family)) {
      const job = workflows.get(file).get(id);
      const platforms = platformsFor(key);
      const runner = platforms.length === 2 ? '${{ matrix.os }}'
        : platforms[0] === 'Linux' ? 'ubuntu-latest' : 'windows-latest';
      assert.ok(job.includes(`    runs-on: ${runner}\n`));
      const allSteps = steps(job, 6);
      const hooks = allSteps.filter(step => step.includes(`uses: ${actionUse}\n`));
      assert.equal(hooks.length, 1, `${file}/${id}`);
      const hook = hooks[0];
      assert.equal(hook, allSteps.at(-1), `${file}/${id}: capture must follow all existing steps`);
      assert.ok(hook.startsWith(`      - name: ${hookName}\n`));
      assert.ok(allSteps.slice(0, -1).some(step => step.includes('uses: actions/checkout@')));
      assert.match(hook, /^        continue-on-error: true$/mu);
      assert.match(hook, /^        timeout-minutes: 3$/mu);
      assert.doesNotMatch(hook, /^        (?:run|env):/mu);
      assert.ok(hook.includes(`          job-key: ${key}-\${{ strategy.job-index || 0 }}\n`));
      assert.ok(hook.includes('          job-outcome: ${{ job.status }}\n'));
      for (const [input, variable] of [['public-key', 'PUBLIC_KEY'], ['fingerprint', 'KEY_FINGERPRINT'], ['verified-fingerprint', 'VERIFIED_FINGERPRINT']]) {
        assert.ok(hook.includes(`          ${input}: \${{ vars.EKY_DIAGNOSTIC_${variable} }}\n`));
      }
      const gate = condition(hook, 8);
      assert.doesNotMatch(gate, /steps\.|needs\.|success\(\)/u);
      for (const platform of platforms) {
        assert.ok(evaluate(gate, undefined, platform));
        assert.ok(evaluate(gate, c => { c.job.status = 'cancelled'; }, platform));
        for (const event of ['push', 'schedule', 'workflow_dispatch']) {
          assert.ok(evaluate(gate, c => { c.github.event_name = event; }, platform));
        }
        for (const mutate of [
          c => { c.job.status = 'success'; },
          c => { c.job.status = 'skipped'; },
          c => { c.runner.os = 'macOS'; },
          c => { c.runner.environment = 'self-hosted'; },
          c => { c.github.event.pull_request.head.repo.full_name = 'outside/fork'; },
          c => { c.github.event_name = 'pull_request_target'; },
          c => { c.github.event_name = 'workflow_run'; },
          c => { c.vars.EKY_DIAGNOSTIC_PUBLIC_KEY = ''; },
          c => { c.vars.EKY_DIAGNOSTIC_KEY_FINGERPRINT = ''; },
          c => { c.vars.EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT = 'B'.repeat(40); },
          c => { c.hashFiles = path => path === actionPath ? '' : 'present'; },
          c => { c.hashFiles = path => path === collectorPath ? '' : 'present'; },
        ]) assert.equal(evaluate(gate, mutate, platform), false, `${file}/${id}: denied context`);
      }
      for (const platform of ['Windows', 'Linux'].filter(value => !platforms.includes(value))) {
        assert.equal(evaluate(gate, undefined, platform), false);
      }
      if (key === 'supervisor-contracts') {
        assert.ok(evaluate(gate, c => { c.inputs.mode = 'contracts'; }));
        assert.equal(evaluate(gate, c => { c.inputs.mode = 'packaged-boundary-diagnostic'; }), false);
      }
      count++;
    }
  }
  assert.equal(count, 18);
});

function assertCompositeTrust(source) {
  assert.match(source, /^  using: composite$/mu);
  const [seal, upload] = steps(source, 4);
  assert.equal(steps(source, 4).length, 2);
  const gate = condition(seal, 6);
  for (const platform of ['Windows', 'Linux']) {
    assert.ok(evaluate(gate, undefined, platform));
    assert.ok(evaluate(gate, c => { c.inputs['job-outcome'] = 'cancelled'; }, platform));
    for (const event of ['push', 'schedule', 'workflow_dispatch']) {
      assert.ok(evaluate(gate, c => { c.github.event_name = event; }, platform));
    }
    for (const mutate of [
      c => { c.inputs['job-outcome'] = 'success'; },
      c => { c.inputs['job-outcome'] = 'skipped'; },
      c => { c.runner.os = 'macOS'; },
      c => { c.runner.environment = 'self-hosted'; },
      c => { c.github.event_name = 'pull_request_target'; },
      c => { c.github.event_name = 'workflow_run'; },
      c => { c.github.event.pull_request.head.repo.full_name = 'outside/fork'; },
      c => { c.inputs['public-key'] = ''; },
      c => { c.inputs.fingerprint = ''; },
      c => { c.inputs['verified-fingerprint'] = ''; },
      c => { c.inputs['verified-fingerprint'] = 'B'.repeat(40); },
    ]) assert.equal(evaluate(gate, mutate, platform), false);
  }
  assert.match(seal, /^      shell: pwsh$/mu);
  assert.ok(seal.includes('      working-directory: ${{ github.workspace }}'));
  for (const [variable, input] of [['EKY_DIAGNOSTIC_PUBLIC_KEY', 'public-key'], ['EKY_DIAGNOSTIC_KEY_FINGERPRINT', 'fingerprint'],
    ['EKY_DIAGNOSTIC_VERIFIED_FINGERPRINT', 'verified-fingerprint'], ['EKY_EVIDENCE_JOB_KEY', 'job-key'], ['EKY_EVIDENCE_JOB_OUTCOME', 'job-outcome']]) {
    assert.ok(seal.includes(`        ${variable}: \${{ inputs.${input} }}\n`));
  }
  assert.ok(seal.includes(`Join-Path $env:GITHUB_WORKSPACE '${collectorPath}'`));
  assert.match(seal, /Get-Command node -CommandType Application -ErrorAction SilentlyContinue/u);
  assert.match(seal, /if \(-not \$node -or -not \(Test-Path -LiteralPath \$collector -PathType Leaf\)\)/u);
  assert.match(seal, /Write-Output 'CI_FAILURE_EVIDENCE_UNAVAILABLE'\n\s+exit 1/u);
  assert.match(seal, /& \$node\.Source \$collector\n\s+exit \$LASTEXITCODE/u);
  assert.doesNotMatch(source, /prepareLockedPnpm|\bpnpm\b|\bnpm\b|secrets\.|toJSON\(|Write-Output \$_|continue-on-error:/u);
  assert.ok(upload);
}

test('composite repeats trust checks and rejects adverse trust mutations on both platforms', () => {
  assertCompositeTrust(action);
  for (const changed of [
    action.replace('always() &&', 'always() ||'),
    action.replace("runner.environment == 'github-hosted'", 'true'),
    action.replace("inputs.job-outcome == 'failure'", "inputs.job-outcome == 'success'"),
    action.replace('github.event.pull_request.head.repo.full_name == github.repository', 'true'),
    action.replace("github.event_name == 'push'", "github.event_name == 'pull_request_target'"),
    action.replace('inputs.fingerprint == inputs.verified-fingerprint', 'true'),
  ]) {
    assert.notEqual(changed, action);
    assert.throws(() => assertCompositeTrust(changed));
  }
});

function assertCiphertextPublication(source) {
  assert.equal(steps(source, 4).length, 2);
  const upload = steps(source, 4)[1];
  assert.deepEqual(upload.match(/^      if: .+$/gmu),
    ["      if: ${{ always() && steps.seal.outcome == 'success' && steps.seal.outputs.sealed == 'true' && steps.seal.outputs.ciphertext != '' }}"]);
  assert.deepEqual(upload.match(/^      uses: .+$/gmu), [`      uses: ${uploadPin}`]);
  for (const [field, value] of [
    ['path', '${{ steps.seal.outputs.ciphertext }}'],
    ['name', 'ci-failure-${{ inputs.job-key }}-${{ github.run_id }}-${{ github.run_attempt }}'],
    ['if-no-files-found', 'error'], ['retention-days', '1'], ['compression-level', '0'],
    ['overwrite', 'false'], ['include-hidden-files', 'false'],
  ]) {
    assert.deepEqual(upload.match(new RegExp(`^        ${field}: .+$`, 'gmu')), [`        ${field}: ${value}`]);
  }
  assert.doesNotMatch(upload, /\*|\.json|\.zip|runner\.temp|github\.workspace/u);
}

test('only exact sealed ciphertext can upload, without collisions or plaintext fallback', () => {
  assertCiphertextPublication(action);
  for (const changed of [
    action.replace("steps.seal.outcome == 'success'", 'true'),
    action.replace("steps.seal.outputs.sealed == 'true'", 'true'),
    action.replace("steps.seal.outputs.ciphertext != ''", 'true'),
    action.replace('path: ${{ steps.seal.outputs.ciphertext }}', 'path: ${{ runner.temp }}/**'),
    action.replace('path: ${{ steps.seal.outputs.ciphertext }}', 'path: evidence.json'),
    action.replace('        retention-days: 1', '        retention-days: 1\n        retention-days: 2'),
    action.replace('if-no-files-found: error', 'if-no-files-found: warn'),
    action.replace('overwrite: false', 'overwrite: true'),
    action.replace('include-hidden-files: false', 'include-hidden-files: true'),
  ]) {
    assert.notEqual(changed, action);
    assert.throws(() => assertCiphertextPublication(changed));
  }
  const names = new Set();
  for (const key of Object.values(normalFamilies).flatMap(family => Object.values(family))) {
    for (const run of [1, 2]) for (const attempt of [1, 2]) for (let index = 0; index < 12; index++) {
      const name = `ci-failure-${key}-${index}-${run}-${attempt}`;
      assert.match(name, /^[a-z0-9-]+$/u);
      assert.ok(!names.has(name));
      names.add(name);
    }
  }
});

test('workflow coverage regression runs in the ordinary cadence job on both platforms', () => {
  const root = JSON.parse(read('../../eky_software/package.json'));
  const command = root.scripts['test:ci'].split(' ');
  assert.deepEqual(command.slice(0, 3), ['node', '--test', '--test-concurrency=1']);
  assert.equal(command.filter(value => value === '../.github/scripts/ciFailureEvidenceWiring.test.mjs').length, 1);
  const cadence = workflows.get('ci-cadence-contracts.yml').get('cadence_contracts');
  assert.match(cadence, /os: \[ubuntu-latest, windows-latest\]/u);
  const check = steps(cadence, 6).find(step => step.includes('- name: Verify failure evidence workflow coverage\n'));
  assert.ok(check);
  assert.match(check, /run: node --test \.github\/scripts\/ciFailureEvidenceWiring\.test\.mjs/u);
  assert.doesNotMatch(check, /continue-on-error:|if:|retries|timeout-minutes:/u);
});

function assertFirstFailureProof(proof, mode, jobKey) {
  assert.deepEqual(proof.match(/^    if: .+$/gmu),
    [`    if: github.event_name == 'workflow_dispatch' && inputs.mode == '${mode}'`]);
  assert.match(proof, /^    timeout-minutes: 5$/mu);
  const allSteps = steps(proof, 6);
  const probe = allSteps.find(step => step.includes('        id: failure_probe\n'));
  const delivery = allSteps.find(step => step.includes('        id: failure_evidence\n'));
  const terminal = allSteps.at(-1);
  assert.doesNotMatch(proof.split('\n    steps:\n')[0], /continue-on-error:/u);
  for (const step of allSteps) {
    if (step !== probe) assert.doesNotMatch(step, /continue-on-error:/u);
  }
  if (mode === 'encrypted-evidence-delivery-proof') {
    const priorPublication = allSteps.findIndex(step => step.includes('- name: Require encrypted delivery publication\n'));
    assert.ok(priorPublication >= 0 && priorPublication < allSteps.indexOf(probe));
  }
  assert.ok(allSteps.indexOf(probe) < allSteps.indexOf(delivery));
  assert.match(probe, /^        continue-on-error: true$/mu);
  assert.match(probe, /^        working-directory: \.$/mu);
  assert.match(probe, /^        run: node \.github\/scripts\/ciFailureEvidenceProbe\.mjs$/mu);
  assert.ok(delivery.includes("if: ${{ always() && steps.failure_probe.outcome == 'failure' && steps.failure_probe.outputs.probe_verified == 'true' }}"));
  assert.ok(delivery.includes(`uses: ${actionUse}\n`));
  assert.ok(delivery.includes(`job-key: ${jobKey}-\${{ strategy.job-index || 0 }}\n`));
  assert.deepEqual(delivery.match(/^        timeout-minutes: .+$/gmu), ['        timeout-minutes: 3']);
  assert.match(delivery, /^          job-outcome: failure$/mu);
  assert.doesNotMatch(delivery, /continue-on-error:/u);
  assert.match(terminal, /^        if: always\(\)$/mu);
  assert.doesNotMatch(terminal, /continue-on-error:/u);
  for (const [variable, expression] of [
    ['PROBE_OUTCOME', 'steps.failure_probe.outcome'],
    ['PROBE_VERIFIED', 'steps.failure_probe.outputs.probe_verified'],
    ['DELIVERY_OUTCOME', 'steps.failure_evidence.outcome'],
    ['SEALED', 'steps.failure_evidence.outputs.sealed'],
    ['UPLOAD_OUTCOME', 'steps.failure_evidence.outputs.upload-outcome'],
    ['ARTIFACT_ID', 'steps.failure_evidence.outputs.artifact-id'],
  ]) assert.ok(terminal.includes(`${variable}: \${{ ${expression} }}\n`));
  for (const [variable, expected] of [['PROBE_OUTCOME', 'failure'], ['PROBE_VERIFIED', 'true'],
    ['DELIVERY_OUTCOME', 'success'], ['SEALED', 'true'], ['UPLOAD_OUTCOME', 'success']]) {
    assert.ok(terminal.includes(`$env:${variable} -cne '${expected}'`));
  }
  assert.ok(terminal.includes("$env:ARTIFACT_ID -cnotmatch '^[1-9][0-9]*$'"));
  assert.match(terminal, /CI_FIRST_FAILURE_EVIDENCE_DELIVERY_UNVERIFIED'\)\n\s+exit 1/u);
  assert.ok(action.includes('value: ${{ steps.seal.outputs.sealed }}'));
  assert.ok(action.includes('value: ${{ steps.upload.outcome }}'));
  assert.ok(action.includes('value: ${{ steps.upload.outputs.artifact-id }}'));
  assert.doesNotMatch(proof, /SYNTHETIC_FIRST_FAILURE_PRIVATE/u);
}

test('hosted Windows proof keeps the verified child and existing delivery contract', () => {
  const proof = workflows.get('windows-acceptance-supervisor-feasibility.yml').get('encrypted-evidence-delivery-proof');
  assertFirstFailureProof(proof, 'encrypted-evidence-delivery-proof', 'delivery-proof');
});

function assertLinuxProof(proof) {
  assertFirstFailureProof(proof, 'linux-encrypted-evidence-delivery-proof', 'linux-delivery-proof');
  assert.deepEqual(proof.match(/^    runs-on: .+$/gmu), ['    runs-on: ubuntu-latest']);
  assert.match(proof, /defaults:\n      run:\n        working-directory: eky_software\/apps\/desktop\n/u);
  const allSteps = steps(proof, 6);
  assert.deepEqual(allSteps.map(step => step.split('\n')[0].trim()), [
    '- name: Check out exact delivery proof revision',
    '- name: Set up pinned Node.js',
    '- name: Verify real OpenPGP and failure collector regressions',
    '- name: Produce one verified synthetic first failure',
    '- name: Deliver synthetic first failure through the normal collector',
    '- name: Require verified first failure and encrypted publication',
  ]);
  assert.match(allSteps[0], /uses: actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1\n/u);
  assert.match(allSteps[0], /persist-credentials: false\n/u);
  assert.match(allSteps[0], /ref: \$\{\{ github.sha \}\}\n/u);
  assert.match(allSteps[1], /uses: actions\/setup-node@820762786026740c76f36085b0efc47a31fe5020\n/u);
  assert.match(allSteps[1], /node-version-file: eky_software\/\.node-version\n/u);
  assert.match(allSteps[1], /package-manager-cache: false\n/u);
  assert.deepEqual(allSteps[2].match(/^        run: .+$/gmu), [
    '        run: node --test --test-concurrency=1 installer/windows-acceptance-harness/ciFailureEvidence.test.mjs installer/windows-acceptance-harness/encryptedEvidenceOpenPgp.test.mjs',
  ]);
  assert.doesNotMatch(allSteps[2], /if:|continue-on-error:|--test-name-pattern|--test-skip-pattern/u);
  assert.doesNotMatch(proof, /needs:|matrix:|secrets\.|\b(?:pnpm|npm|apt|apt-get|sudo|msiexec|dotnet|wpr)\b|setup-dotnet|buildWindows|captureInstaller|download-artifact/u);
}

test('Linux proof requires real crypto regressions before first failure without installation or acceptance', () => {
  const proof = workflows.get('windows-acceptance-supervisor-feasibility.yml').get('linux-encrypted-evidence-delivery-proof');
  assertLinuxProof(proof);
  for (const changed of [
    proof.replace('timeout-minutes: 5', 'timeout-minutes: 6'),
    proof.replace("github.event_name == 'workflow_dispatch'", 'true'),
    proof.replace('runs-on: ubuntu-latest', 'runs-on: self-hosted'),
    proof.replace('      - name: Verify real OpenPGP and failure collector regressions\n',
      '      - name: Verify real OpenPGP and failure collector regressions\n        if: false\n'),
    proof.replace('        run: node --test --test-concurrency=1',
      '        continue-on-error: true\n        run: node --test --test-concurrency=1'),
    proof.replace("steps.failure_probe.outputs.probe_verified == 'true'", 'true'),
    proof.replace("$env:UPLOAD_OUTCOME -cne 'success'", '$false'),
    proof.replace("$env:ARTIFACT_ID -cnotmatch '^[1-9][0-9]*$'", '$false'),
  ]) {
    assert.notEqual(changed, proof);
    assert.throws(() => assertLinuxProof(changed));
  }
});
