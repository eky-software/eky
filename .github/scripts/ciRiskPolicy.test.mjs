import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyCiRisk, CI_GATES, CI_FAULT_SCENARIOS, validateCiRiskPlan } from './ciRiskPolicy.mjs';

const input = (changedPaths, extra = {}) => ({ eventName: 'pull_request', ref: 'refs/pull/1/merge',
  changedPaths, comparisonComplete: true, ...extra });
const path = (suffix) => `eky_software/${suffix}`;

test('ordinary UI, domain and module application edits retain fast security and build gates', () => {
  const plan = classifyCiRisk(input([
    path('apps/web/src/features/customers/CustomerForm.tsx'), path('apps/web/src/app.css'),
    path('packages/domain/src/invoice.ts'), path('apps/backend/src/modules/customers/application/service.ts'),
    path('docs/product/workflows.md'),
  ]));
  assert.equal(plan.risk, 'fast');
  assert.deepEqual(CI_GATES.filter((gate) => plan.gates[gate]), ['verify', 'systemSecurity', 'webCritical']);
  assert.deepEqual(plan.faultScenarios, []);
  assert.equal(plan.repetitions, 1);
});

test('desktop non-lifecycle changes add Windows tests without claiming compatibility risk', () => {
  const plan = classifyCiRisk(input([path('apps/desktop/src/diagnostics/view.ts')]));
  assert.equal(plan.risk, 'installer');
  for (const gate of ['windowsContracts', 'packageSmoke', 'electronCritical', 'cleanLifecycle', 'upgradeRollback', 'workspaceSuccess']) {
    assert.equal(plan.gates[gate], true);
  }
  assert.equal(plan.gates.legacyUpgrade, false);
  assert.equal(plan.gates.workspaceFault, false);
});

for (const file of ['apps/desktop/src/update/firstStartUpdateCoordinator.ts',
  'apps/desktop/src/workspaces/registry.ts', 'apps/desktop/src/main/index.ts',
  'apps/desktop/installer/windows-acceptance-harness/runWorkspaceFault.mjs',
  'apps/backend/src/modules/invoicing/infrastructure/pdf/render.ts',
  'apps/backend/src/modules/customers/ports/snapshot.ts', 'apps/backend/src/bootstrap.ts',
  'apps/e2e/src/fixtures/isolatedElectronTest.ts', 'apps/web/src/desktop/bridge.ts']) {
  test(`shared Windows compatibility boundary selects legacy and all fault contracts: ${file}`, () => {
    const plan = classifyCiRisk(input([path(file)]));
    assert.equal(plan.gates.legacyUpgrade, true);
    assert.equal(plan.gates.workspaceSuccess, true);
    assert.deepEqual(plan.faultScenarios, CI_FAULT_SCENARIOS);
    assert.equal(plan.risk, 'installer');
  });
}

test('dependencies, SQL, build configuration and CI policy require the complete matrix', () => {
  for (const file of ['.github/workflows/ci.yml', 'eky_software/package.json', 'eky_software/pnpm-lock.yaml',
    'eky_software/AGENTS.md', 'eky_software/apps/web/tsconfig.json',
    'eky_software/apps/backend/src/modules/customers/migrations/001.sql',
    'eky_software/docs/architecture/windows-installer-acceptance-harness-v2.md']) {
    const plan = classifyCiRisk(input([file]));
    assert.equal(plan.risk, 'full', file);
    assert.equal(plan.repetitions, 2);
    assert.ok(CI_GATES.every((gate) => plan.gates[gate]));
  }
});

test('unknown paths and unavailable or empty comparison cannot select the fast path', () => {
  for (const value of [input(['new-platform/runtime.ts']), input([], { comparisonComplete: false }), input([])]) {
    const plan = classifyCiRisk(value);
    assert.equal(plan.risk, 'full');
    assert.ok(Object.values(plan.gates).every(Boolean));
  }
});

test('main pushes, scheduled runs and manual release runs always select two full repetitions', () => {
  for (const eventName of ['push', 'schedule', 'workflow_dispatch']) {
    const plan = classifyCiRisk(input([path('apps/web/src/app.css')], { eventName, ref: 'refs/heads/main' }));
    assert.equal(plan.risk, 'full');
    assert.equal(plan.reason, 'releaseEvent');
    assert.equal(plan.repetitions, 2);
  }
});

test('mixed edits and renamed old/new paths preserve the highest risk independent of ordering', () => {
  const files = ['new-platform/unknown.ts', '.github/workflows/ci.yml', path('apps/web/src/app.css')];
  assert.deepEqual(classifyCiRisk(input(files)), classifyCiRisk(input([...files].reverse())));
  const moved = classifyCiRisk(input([path('apps/desktop/src/main/old.ts'), path('apps/web/src/new.ts')]));
  assert.equal(moved.gates.legacyUpgrade, true);
});

test('path matching uses exact root boundaries and accepts spaces and Unicode without publishing them', () => {
  assert.equal(classifyCiRisk(input(['eky_software/apps/web/src-other/a.ts'])).risk, 'full');
  const file = path('apps/web/src/features/example folder/n\u00e4kym\u00e4.tsx');
  const plan = classifyCiRisk(input([file]));
  assert.equal(plan.risk, 'fast');
  assert.ok(!JSON.stringify(plan).includes(file));
});

test('malformed, traversal, control-character and non-data inputs fail closed', () => {
  for (const file of ['', '/absolute', 'C:/outside', 'a\\b', 'a/../b', 'a/./b', 'a//b', 'a\nb', 'a\0b', null]) {
    assert.throws(() => classifyCiRisk(input([file])), /CI_RISK_INPUT_INVALID/);
  }
  for (const value of [null, { ...input([]), unknown: true }, input([], { eventName: 'pull_request_target' }),
    input([], { comparisonComplete: 'true' }), input([], { ref: 'main\nunsafe' })]) {
    assert.throws(() => classifyCiRisk(value), /CI_RISK_INPUT_INVALID/);
  }
  assert.throws(() => classifyCiRisk({ ...input([]), get ref() { throw new Error('getter must not run'); } }), /CI_RISK_INPUT_INVALID/);
});

test('a serialized plan cannot drop mandatory gates, repetitions or fault scenarios', () => {
  const plan = classifyCiRisk(input(['unknown']));
  assert.deepEqual(validateCiRiskPlan(JSON.parse(JSON.stringify(plan))), plan);
  for (const value of [{ ...plan, schemaVersion: 2 }, { ...plan, repetitions: 1 },
    { ...plan, gates: { ...plan.gates, verify: false } }, { ...plan, faultScenarios: [] },
    { ...plan, path: 'private' }, { ...plan, gates: { ...plan.gates, unknown: true } }]) {
    assert.throws(() => validateCiRiskPlan(value), /CI_RISK_INPUT_INVALID/);
  }
});
