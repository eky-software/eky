import assert from 'node:assert/strict';
import { lstat, readFile } from 'node:fs/promises';
import test from 'node:test';

const DESKTOP_ROOT = new URL('../', import.meta.url);
const CI_ROOT = new URL('../../../../.github/', import.meta.url);
const { classifyCiRisk } = await import(new URL('scripts/ciRiskPolicy.mjs', CI_ROOT));
const { requiredCiJobs } = await import(new URL('scripts/ciJobCoverage.mjs', CI_ROOT));
const { CI_WORKFLOWS, evaluateCiRun } = await import(new URL('scripts/ciRunAcceptance.mjs', CI_ROOT));

const COMMANDS = {
  vitest: ['test', 0],
  node: ['test', 1],
  unit: ['installer:test:unit', 0],
  process: ['installer:test:windows-process', 1],
};
const REQUIRED_FILES = [
  ['e2e/electronE2eWorkspaceStartupFailure.test.ts', 'vitest'],
  ['scripts/test-command-wiring.test.mjs', 'node'],
  ['scripts/backendBuildMetadata.test.mjs', 'node'],
  ...[
    'cleanInstallUninstallContracts', 'cleanInstallUninstallLifecycle',
    'cleanInstallUninstallPayload', 'localImmutableInstallerFixture',
    'upgradeRollbackProgress',
  ].map((name) => [`installer/windows-acceptance-harness/${name}.test.mjs`, 'unit']),
  ['installer/windows-acceptance-harness/upgradeRollbackBinaryHandoff.test.mjs', 'process'],
];
const CI_EDGES = [
  { job: 'verify', name: 'Test, typecheck and build', gate: 'verify',
    step: 'Run tests', run: 'pnpm test' },
  { job: 'windows-contracts', name: 'Windows installer contract tests', gate: 'windowsContracts',
    step: 'Run deterministic installer tests', run: 'pnpm --filter @eky/desktop installer:test:unit' },
  { job: 'windows-contracts', name: 'Windows installer contract tests', gate: 'windowsContracts',
    step: 'Run Windows process-contract tests serially', run: 'pnpm --filter @eky/desktop installer:test:windows-process' },
];

async function readFixture() {
  const root = JSON.parse(await readFile(new URL('../../../package.json', import.meta.url), 'utf8'));
  const desktop = JSON.parse(await readFile(new URL('package.json', DESKTOP_ROOT), 'utf8'));
  const files = new Set();
  for (const [path] of REQUIRED_FILES) {
    try {
      if ((await lstat(new URL(path, DESKTOP_ROOT))).isFile()) files.add(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  const plan = classifyCiRisk({ eventName: 'pull_request', ref: 'refs/pull/1/merge',
    changedPaths: ['eky_software/apps/desktop/package.json'], comparisonComplete: true });
  return { root, desktop, files, plan, coverage: requiredCiJobs(plan),
    core: (await readFile(new URL('workflows/ci.yml', CI_ROOT), 'utf8')).replaceAll('\r\n', '\n'),
    caller: (await readFile(new URL('workflows/ci-cadence-contracts.yml', CI_ROOT), 'utf8')).replaceAll('\r\n', '\n') };
}

function commandChain(script, length) {
  assert.equal(typeof script, 'string', 'Required package script is missing');
  const commands = script.split(' && ');
  assert.equal(commands.length, length, 'Required command chain changed');
  return commands;
}

// Only the existing literal test commands are accepted, not general shell syntax.
function testFiles(command, prefix, extension) {
  const tokens = command.trim().split(/\s+/u);
  assert.deepEqual(tokens.splice(0, prefix.length), prefix, 'Wrong test runner or flags');
  assert.ok(tokens.length > 0);
  for (const token of tokens) {
    assert.ok((extension === 'ts' && token === 'src') ||
      new RegExp(`^[A-Za-z0-9_./-]+\\.test\\.${extension}$`, 'u').test(token),
    `Unexpected test argument: ${token}`);
  }
  assert.equal(new Set(tokens).size, tokens.length, 'Duplicate test selection');
  return tokens;
}

function assertPackageWiring({ root, desktop, files }) {
  assert.equal(root.scripts.test, 'pnpm --recursive test');
  assert.equal(desktop.name, '@eky/desktop');
  const ordinary = commandChain(desktop.scripts.test, 2);
  const unit = commandChain(desktop.scripts['installer:test:unit'], 1);
  const process = commandChain(desktop.scripts['installer:test:windows-process'], 2);
  assert.equal(process[0], 'pnpm installer:supervisor:build');
  assert.equal(desktop.scripts['installer:supervisor:build'],
    'node installer/windows-process-supervisor/buildWindowsAcceptanceSupervisor.mjs');
  const selected = {
    vitest: testFiles(ordinary[0], ['vitest', 'run'], 'ts'),
    node: testFiles(ordinary[1], ['node', '--test'], 'mjs'),
    unit: testFiles(unit[0], ['node', '--test'], 'mjs'),
    process: testFiles(process[1], ['node', '--test', '--test-concurrency=1'], 'mjs'),
  };
  assert.ok(selected.vitest.includes('src'), 'Existing desktop source tests must remain selected');
  assert.ok(selected.process.includes('installer/scripts/launchRollbackWindowsInstaller.test.mjs'));
  for (const [path, owner] of REQUIRED_FILES) {
    assert.ok(files.has(path), `Required physical test file is missing: ${path}`);
    for (const [group, paths] of Object.entries(selected)) {
      assert.equal(paths.includes(path), group === owner, `Wrong selection for ${path} in ${group}`);
    }
  }
}

// These bounded blocks intentionally require the repository's current YAML layout.
function jobBlock(source, name) {
  const sections = source.replaceAll('\r\n', '\n').split('\njobs:\n');
  assert.equal(sections.length, 2, 'Expected one jobs mapping');
  const headers = [...sections[1].matchAll(/^  ([\w-]+):\n/gmu)];
  const matching = headers.filter((header) => header[1] === name);
  assert.equal(matching.length, 1, `Required job missing or duplicated: ${name}`);
  const index = headers.indexOf(matching[0]);
  return sections[1].slice(matching[0].index, headers[index + 1]?.index).trimEnd();
}

function stepBlock(job, name) {
  assert.equal(job.split('\n    steps:\n').length, 2, 'Expected one steps list');
  const headers = [...job.matchAll(/^      - [^\n]+/gmu)];
  const matching = headers.filter((header) => header[0] === `      - name: ${name}`);
  assert.equal(matching.length, 1, `Required step missing or duplicated: ${name}`);
  const index = headers.indexOf(matching[0]);
  return job.slice(matching[0].index, headers[index + 1]?.index).trimEnd();
}

function property(source, indentation, key, value) {
  const prefix = `${' '.repeat(indentation)}${key}:`;
  assert.deepEqual(source.split('\n').filter((line) => line.startsWith(prefix)),
    [`${prefix} ${value}`], `Required ${key} binding changed`);
}

function assertCiWiring({ core, caller, plan, coverage }) {
  assert.equal(plan.risk, 'full');
  assert.equal(plan.repetitions, 2);
  assert.equal(plan.gates.verify, true);
  assert.equal(plan.gates.windowsContracts, true);
  for (const edge of CI_EDGES) {
    const job = jobBlock(core, edge.job);
    const header = job.split('\n    steps:\n')[0];
    property(header, 4, 'name', edge.name);
    property(header, 4, 'if', edge.job === 'verify' ? "inputs.risk_plan != ''"
      : "inputs.risk_plan != '' && fromJSON(inputs.risk_plan).gates.windowsContracts");
    property(header, 4, 'runs-on', edge.job === 'verify' ? 'ubuntu-latest' : 'windows-latest');
    property(header, 8, 'working-directory', 'eky_software');
    assert.doesNotMatch(header, /^    continue-on-error:/mu);
    assert.equal(stepBlock(job, edge.step), `      - name: ${edge.step}\n        run: ${edge.run}`);
    const required = coverage[edge.gate].filter((entry) => entry.name === edge.name);
    assert.equal(required.length, 1, 'Required CI job coverage missing or duplicated');
    assert.equal(required[0].steps.filter((step) => step === edge.step).length, 1,
      `Required CI step coverage missing or duplicated: ${edge.step}`);
  }
  assert.match(core.replaceAll('\r\n', '\n'),
    /^  workflow_call:\n    inputs:\n      risk_plan:\n        required: true\n        type: string$/mu);
  assert.match(caller, /^  pull_request:\r?$/mu);
  assert.match(caller, /^  push:\r?\n    branches: \[main\]\r?$/mu);
  assert.equal(jobBlock(caller, 'core'), [
    '  core:', '    needs: classification', '    uses: ./.github/workflows/ci.yml',
    '    with:', '      risk_plan: ${{ needs.classification.outputs.plan }}',
    "      linux_ownership_prerequisites: ${{ github.event_name == 'workflow_dispatch' && inputs.linux_ownership_prerequisites == true }}",
  ].join('\n'));
  const acceptance = jobBlock(caller, 'acceptance');
  const header = acceptance.split('\n    steps:\n')[0];
  property(header, 4, 'name', 'V2 acceptance');
  property(header, 4, 'if', 'always()');
  assert.ok(CI_WORKFLOWS.includes('core'));
  property(header, 4, 'needs', `[${CI_WORKFLOWS.join(', ')}]`);
  assert.doesNotMatch(header, /^    continue-on-error:/mu);
  assert.equal(stepBlock(acceptance, 'Require exact selected jobs and matrix members'), [
    '      - name: Require exact selected jobs and matrix members', '        env:',
    '          CI_NEEDS: ${{ toJSON(needs) }}', '          GH_TOKEN: ${{ github.token }}',
    '        run: node .github/scripts/verifyCiRun.mjs',
  ].join('\n'));
}

function assertWiring(fixture) {
  assertPackageWiring(fixture);
  assertCiWiring(fixture);
}

function editCommand(fixture, group, change) {
  const [script, index] = COMMANDS[group];
  const commands = fixture.desktop.scripts[script].split(' && ');
  commands[index] = change(commands[index]);
  fixture.desktop.scripts[script] = commands.join(' && ');
}

const original = await readFixture();

function rejectsMutation(change) {
  assertWiring(original);
  const fixture = structuredClone(original);
  change(fixture);
  assert.notDeepEqual(fixture, original, 'Mutation must change the fixture');
  assert.throws(() => assertWiring(fixture), { code: 'ERR_ASSERTION' });
}

test('T1 files and the wiring test reach their required commands and normal CI acceptance', () => {
  assertWiring(original);
});

for (const [path, group] of REQUIRED_FILES) {
  test(`rejects a missing physical file: ${path}`, () => {
    rejectsMutation((fixture) => fixture.files.delete(path));
  });
  test(`rejects a missing invocation: ${path}`, () => {
    rejectsMutation((fixture) => editCommand(fixture, group, (command) => command.replace(` ${path}`, '')));
  });
  test(`rejects the wrong command group: ${path}`, () => {
    rejectsMutation((fixture) => {
      editCommand(fixture, group, (command) => command.replace(` ${path}`, ''));
      const wrongGroup = group === 'vitest' ? 'node' : group === 'unit' ? 'process' : 'unit';
      editCommand(fixture, wrongGroup, (command) => `${command} ${path}`);
    });
  });
}

for (const group of Object.keys(COMMANDS)) {
  test(`rejects the wrong runner: ${group}`, () => {
    rejectsMutation((fixture) => editCommand(fixture, group, (command) =>
      command.replace(group === 'vitest' ? 'vitest run' : 'node --test', group === 'vitest' ? 'node --test' : 'vitest run')));
  });
}

for (const [name, change] of [
  ['root recursive call missing', (f) => { delete f.root.scripts.test; }],
  ['root recursion removed', (f) => { f.root.scripts.test = 'pnpm test'; }],
  ...['test', 'installer:test:unit', 'installer:test:windows-process', 'installer:supervisor:build']
    .map((name) => [`script missing: ${name}`, (f) => { delete f.desktop.scripts[name]; }]),
  ['serial flag missing', (f) => editCommand(f, 'process', (s) => s.replace(' --test-concurrency=1', ''))],
  ['parallel process tests', (f) => editCommand(f, 'process', (s) => s.replace('--test-concurrency=1', '--test-concurrency=2'))],
  ['supervisor prerequisite missing', (f) => { f.desktop.scripts['installer:test:windows-process'] = f.desktop.scripts['installer:test:windows-process'].split(' && ')[1]; }],
  ['supervisor prerequisite reordered', (f) => { f.desktop.scripts['installer:test:windows-process'] = f.desktop.scripts['installer:test:windows-process'].split(' && ').reverse().join(' && '); }],
  ['supervisor build replaced', (f) => { f.desktop.scripts['installer:supervisor:build'] = 'node --version'; }],
]) {
  test(`rejects ${name}`, () => rejectsMutation(change));
}

for (const edge of CI_EDGES) {
  test(`rejects missing workflow invocation: ${edge.step}`, () => {
    rejectsMutation((f) => { f.core = f.core.replace(`        run: ${edge.run}\n`, ''); });
  });
  test(`rejects a renamed workflow step even with its command retained: ${edge.step}`, () => {
    rejectsMutation((f) => { f.core = f.core.replace(`- name: ${edge.step}\n`, '- name: Unrelated step\n'); });
  });
  test(`rejects a conditional workflow invocation: ${edge.step}`, () => {
    rejectsMutation((f) => { f.core = f.core.replace(`        run: ${edge.run}`, `        if: false\n        run: ${edge.run}`); });
  });
  test(`rejects missing required step coverage: ${edge.step}`, () => {
    rejectsMutation((f) => {
      const required = f.coverage[edge.gate].find((job) => job.name === edge.name);
      required.steps = required.steps.filter((step) => step !== edge.step);
    });
  });
}

for (const [name, before, after] of [
  ['normal caller', '    uses: ./.github/workflows/ci.yml', '    uses: ./.github/workflows/unrelated.yml'],
  ['risk plan binding', '      risk_plan: ${{ needs.classification.outputs.plan }}', '      risk_plan: unrelated'],
  ['missing prerequisite opt-in', "      linux_ownership_prerequisites: ${{ github.event_name == 'workflow_dispatch' && inputs.linux_ownership_prerequisites == true }}", ''],
  ['unconditional prerequisite opt-in', "      linux_ownership_prerequisites: ${{ github.event_name == 'workflow_dispatch' && inputs.linux_ownership_prerequisites == true }}", '      linux_ownership_prerequisites: true'],
  ['non-manual prerequisite opt-in', "github.event_name == 'workflow_dispatch' && inputs.linux_ownership_prerequisites == true", 'inputs.linux_ownership_prerequisites == true'],
  ['acceptance dependency', 'cadence_contracts, core, supervisor', 'cadence_contracts, supervisor'],
  ['acceptance invocation', '        run: node .github/scripts/verifyCiRun.mjs', '        run: node --version'],
  ['pull request trigger', '  pull_request:', '  unrelated_event:'],
]) {
  test(`rejects a broken ${name}`, () => {
    rejectsMutation((f) => { f.caller = f.caller.replace(before, after); });
  });
}

function successfulEvidence() {
  const needs = Object.fromEntries(CI_WORKFLOWS.map((name) => [name, { result: 'success', outputs: {} }]));
  const jobs = [];
  for (const member of Object.values(original.coverage).flat()) {
    let job = jobs.find((entry) => entry.name === `core / ${member.name}`);
    if (!job) {
      job = { id: jobs.length + 1, name: `core / ${member.name}`, status: 'completed', conclusion: 'success', steps: [] };
      jobs.push(job);
    }
    for (const name of member.steps) if (!job.steps.some((step) => step.name === name)) {
      job.steps.push({ name, status: 'completed', conclusion: 'success' });
    }
  }
  return { needs, jobs };
}

test('current acceptance rejects missing or unsuccessful T1 steps despite successful workflow results', () => {
  assertWiring(original);
  const successful = successfulEvidence();
  assert.equal(evaluateCiRun(original.plan, successful.needs, successful.jobs).status, 'completed');
  for (const edge of CI_EDGES) {
    for (const outcome of ['missing', 'failure', 'cancelled', 'skipped']) {
      const { needs, jobs } = structuredClone(successful);
      const job = jobs.find((entry) => entry.name === `core / ${edge.name}`);
      const index = job.steps.findIndex((step) => step.name === edge.step);
      assert.ok(index >= 0);
      if (outcome === 'missing') job.steps.splice(index, 1);
      else job.steps[index].conclusion = outcome;
      assert.equal(evaluateCiRun(original.plan, needs, jobs).resultCode,
        'CI_REQUIRED_STEP_INCOMPLETE', `${edge.step}: ${outcome}`);
    }
  }
  delete successful.needs.core;
  assert.equal(evaluateCiRun(original.plan, successful.needs, successful.jobs).resultCode, 'workflowResultsInvalid');
});
