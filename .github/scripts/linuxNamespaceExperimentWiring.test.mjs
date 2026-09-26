import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const core = read('../workflows/ci.yml');
const cadence = read('../workflows/ci-cadence-contracts.yml');
const consumers = [
  { job: 'e2e-system-security', normal: 'Run isolated system security E2E tests',
    label: 'system', consumer: 'system-api',
    command: 'pnpm test:e2e:system' },
  { job: 'e2e-web-critical', normal: 'Run critical web E2E journeys',
    label: 'web', consumer: 'web-chromium',
    command: 'pnpm --filter @eky/e2e e2e:web:critical' },
];
const mechanisms = [
  { flag: 'linux_pid_namespace_experiment', file: 'runPidNamespaceExperiment', label: 'PID' },
  { flag: 'linux_managed_namespace_experiment', file: 'runManagedNamespaceExperiment', label: 'managed' },
];
const cases = mechanisms.flatMap(mechanism => consumers.map(consumer => ({ ...mechanism, ...consumer,
  experiment: `Observe bounded ${consumer.label} ${mechanism.label} namespace experiment` })));

function job(source, name) {
  const section = source.split(`\n  ${name}:\n`)[1]?.split(/\n  [\w-]+:\n/u)[0];
  assert.ok(section, 'JOB_MISSING');
  return section;
}

function step(source, name) {
  const section = source.split(`      - name: ${name}\n`)[1]?.split('\n      - name:')[0];
  assert.ok(section, 'STEP_MISSING');
  return section.trimEnd();
}

function verify(source, definition) {
  const section = job(source, definition.job);
  const normal = step(section, definition.normal);
  assert.ok(normal.endsWith(`          ${definition.command}`));
  assert.doesNotMatch(normal, /run(?:Pid|Managed)NamespaceExperiment|continue-on-error|success\(\)/u);
  assert.ok(section.indexOf(definition.normal) < section.indexOf(definition.experiment));
  const experiment = step(section, definition.experiment);
  assert.equal(experiment, [
    `        if: success() && inputs.${definition.flag} == true`,
    '        env:',
    "          EKY_E2E: '1'",
    '        run: |',
    '          checkout_sha="$(git rev-parse --verify HEAD 2>/dev/null)" || checkout_sha=""',
    `          node apps/e2e/experiments/processOwnership/${definition.file}.mjs --consumer=${definition.consumer} --checkout-sha="$checkout_sha" 2>/dev/null`,
  ].join('\n'));
  return experiment;
}

for (const { flag } of mechanisms) test(`${flag}: separately default-off and manual across caller/reusable boundary`, () => {
  assert.match(cadence.split('permissions:')[0], new RegExp(`${flag}:\\n        description: [^\\n]+\\n        type: boolean\\n        default: false`, 'u'));
  assert.match(core.split('permissions:')[0], new RegExp(`${flag}:\\n        required: false\\n        type: boolean\\n        default: false`, 'u'));
  const expression = job(cadence, 'core').match(new RegExp(`${flag}: \\$\\{\\{ (.+) \\}\\}`, 'u'))?.[1];
  assert.equal(expression, `github.event_name == 'workflow_dispatch' && inputs.${flag} == true`);
  for (const event of ['push', 'pull_request', 'schedule', 'workflow_dispatch']) {
    for (const enabled of [undefined, false, true, 'true', 'false']) {
      assert.equal(runInNewContext(expression, { github: { event_name: event },
        inputs: { [flag]: enabled } }, { timeout: 1000 }),
      event === 'workflow_dispatch' && enabled === true);
    }
  }
});

for (const definition of cases) {
  test(`${definition.flag}/${definition.consumer}: normal test precedes experiment; failures keep their original status`, () => {
    const experiment = verify(core, definition);
    const expression = experiment.split('\n')[0].trim().slice('if: '.length);
    for (const testStatus of [0, 1, 23, 124, 137]) {
      for (const enabled of [false, true]) {
        const selected = runInNewContext(expression, {
          success: () => testStatus === 0, inputs: { [definition.flag]: enabled },
        }, { timeout: 1000 });
        assert.equal(selected, testStatus === 0 && enabled);
        // The normal command remains a separate step with no condition or status wrapper.
        if (testStatus !== 0) assert.equal(selected, false);
      }
    }
    // A direct final command propagates its status; no || true, retry or result-normalizing shell.
    assert.match(experiment.split('\n').at(-1), /^          node .+ 2>\/dev\/null$/u);
    assert.doesNotMatch(experiment, /continue-on-error|exit 0|\|\| true|sudo|apt|timeout-minutes|kill|retry/u);
  });

  test(`${definition.flag}/${definition.consumer}: always-on, swallowed-status and unbound variants are rejected`, () => {
    const original = step(job(core, definition.job), definition.experiment);
    for (const changed of [
      original.replace('success() && ', ''),
      original.replace(`inputs.${definition.flag} == true`, 'true'),
      `${original} || true`,
      original.replace('--checkout-sha="$checkout_sha"', '--checkout-sha=HEAD'),
      original.replace("EKY_E2E: '1'", "EKY_E2E: '0'"),
    ]) assert.throws(() => verify(core.replace(original, changed), definition));
    assert.throws(() => verify(core.replace(definition.normal, 'Missing normal test'), definition));
  });
}

test('only two existing Linux jobs contain the experiment and core/risk/acceptance boundaries remain', () => {
  for (const { file } of mechanisms) {
    assert.equal(core.match(new RegExp(`${file}\\.mjs`, 'gu'))?.length, 2);
    assert.ok(!job(core, 'e2e-electron-windows-critical').includes(file));
  }
  assert.doesNotMatch(core, /continue-on-error:/u);
  assert.match(job(cadence, 'core'), /risk_plan: \$\{\{ needs\.classification\.outputs\.plan \}\}/u);
  assert.match(job(cadence, 'acceptance'), /needs: \[classification, cadence_contracts, core, supervisor, clean, upgrade, legacy, workspace\]/u);
});

test('cadence runs only the pure Linux contract, runtime-mock and wiring tests', () => {
  const script = job(cadence, 'cadence_contracts').match(/        run: (node --test[^\n]+)/u)?.[1];
  assert.ok(script);
  for (const file of [
    '.github/scripts/linuxNamespaceExperimentWiring.test.mjs',
    'eky_software/apps/e2e/experiments/processOwnership/pidNamespaceContract.test.mjs',
    'eky_software/apps/e2e/experiments/processOwnership/runPidNamespaceExperiment.test.mjs',
    'eky_software/apps/e2e/experiments/processOwnership/managedNamespaceResult.test.mjs',
    'eky_software/apps/e2e/experiments/processOwnership/runManagedNamespaceExperiment.test.mjs',
  ]) assert.ok(script.split(' ').includes(file));
  assert.doesNotMatch(script, /\srun(?:Pid|Managed)NamespaceExperiment\.mjs\s/u);
  assert.match(script, /--test-concurrency=1/u);
});
