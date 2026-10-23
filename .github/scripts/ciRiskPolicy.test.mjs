import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';

import { classifyCiRisk, CI_GATES, CI_FAULT_SCENARIOS, validateCiRiskPlan } from './ciRiskPolicy.mjs';

const input = (changedPaths, extra = {}) => ({ eventName: 'pull_request', ref: 'refs/pull/1/merge',
  changedPaths, comparisonComplete: true, ...extra });
const path = (suffix) => `eky_software/${suffix}`;
const customerBrowserScenarios = [
  'customerAndCompanyJourneys.spec.ts', 'customerOverviewJourneys.spec.ts',
  'customerRelationshipJourneys.spec.ts', 'customerInvariantJourneys.spec.ts',
].map((name) => path(`apps/e2e/tests/web/${name}`));

for (const file of customerBrowserScenarios) {
  test(`reviewed customer browser scenario retains the three fast gates: ${file}`, () => {
    assert.ok(existsSync(new URL(`../../${file}`, import.meta.url)));
    const plan = classifyCiRisk(input([file]));
    assert.equal(plan.risk, 'fast');
    assert.deepEqual(CI_GATES.filter((gate) => plan.gates[gate]), ['verify', 'systemSecurity', 'webCritical']);
    assert.deepEqual(plan.faultScenarios, []);
    assert.equal(plan.repetitions, 1);
    assert.deepEqual(validateCiRiskPlan(JSON.parse(JSON.stringify(plan))), plan);
  });
}

test('customer browser selection does not generalize to neighbours or shared E2E support', () => {
  for (const suffix of [
    'tests/web/newCustomerJourneys.spec.ts', 'tests/web/CustomerInvariantJourneys.spec.ts',
    'tests/web/customerInvariantJourneys.spec.ts.bak', 'tests/web/nested/customerInvariantJourneys.spec.ts',
    'tests/system/customerInvariants.spec.ts', 'tests/electron/customerInvariantJourneys.spec.ts',
    'tests/electron-stress/customerInvariantJourneys.spec.ts',
    'tests/web/operationalLogNoticeJourneys.spec.ts', 'playwright.config.ts',
    'playwright.packaged-legacy.config.ts', 'src/fixtures/isolatedWebTest.ts',
    'src/environment/createE2eWebRuntime.ts', 'src/journeys/invoicingWebJourney.ts',
    'src/data/syntheticBusinessInputs.ts', 'scripts/safeCiReporter.mjs',
  ]) {
    const plan = classifyCiRisk(input([path(`apps/e2e/${suffix}`)]));
    assert.equal(plan.risk, 'installer', suffix);
    assert.ok(CI_GATES.every((gate) => plan.gates[gate]), suffix);
    assert.deepEqual(plan.faultScenarios, CI_FAULT_SCENARIOS, suffix);
    assert.equal(plan.repetitions, 1, suffix);
  }
  assert.equal(classifyCiRisk(input(['other/apps/e2e/tests/web/customerInvariantJourneys.spec.ts'])).risk, 'full');
});

test('mixed customer scenario changes keep the strictest risk independent of path order', () => {
  for (const [other, risk, repetitions] of [
    [path('apps/e2e/src/fixtures/isolatedWebTest.ts'), 'installer', 1],
    [path('apps/desktop/src/main/index.ts'), 'installer', 1],
    [path('pnpm-lock.yaml'), 'full', 2],
    [path('apps/backend/src/modules/customers/migrations/001.sql'), 'full', 2],
    ['.github/scripts/ciRiskPolicy.mjs', 'full', 2],
    ['unknown/platform.ts', 'full', 2],
  ]) {
    const files = [...customerBrowserScenarios, other];
    const plan = classifyCiRisk(input(files));
    assert.deepEqual(plan, classifyCiRisk(input([...files].reverse())));
    assert.equal(plan.risk, risk);
    assert.equal(plan.repetitions, repetitions);
    assert.ok(CI_GATES.every((gate) => plan.gates[gate]));
    assert.deepEqual(plan.faultScenarios, CI_FAULT_SCENARIOS);
  }
});

test('customer scenarios do not reduce incomplete comparisons or any main and release event', () => {
  const incomplete = classifyCiRisk(input(customerBrowserScenarios, { comparisonComplete: false }));
  assert.equal(incomplete.risk, 'full');
  assert.equal(incomplete.reason, 'comparisonUnavailable');
  for (const eventName of ['push', 'schedule', 'workflow_dispatch']) {
    const plan = classifyCiRisk(input(customerBrowserScenarios, { eventName, ref: 'refs/heads/main' }));
    assert.equal(plan.risk, 'full');
    assert.ok(CI_GATES.every((gate) => plan.gates[gate]));
    assert.deepEqual(plan.faultScenarios, CI_FAULT_SCENARIOS);
    assert.equal(plan.repetitions, 2);
  }
});

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

test('actual backup, restore, recovery and runtime ownership paths retain compatibility coverage', () => {
  const files = [
    'profileBackup/profileBackupComposition.ts',
    'profileBackup/restore/profileRestoreStartupRecovery.ts',
    'profileBackup/recoveryPoint/recoveryPointService.ts',
    'runtime/backendShutdown.ts', 'runtime/desktopProfilePaths.ts', 'runtime/runtimeSession.ts',
    'secrets/secretBrokerMain.ts', 'release/desktopPackageModeReader.ts',
    'invoicePdfArchive/invoicePdfArchiveJournal.ts',
    'observability/infrastructure/jsonLineDesktopOperationalLogger.ts',
    'security/electronPermissionPolicy.ts',
  ];
  for (const file of files) {
    const repositoryPath = path(`apps/desktop/src/${file}`);
    assert.ok(existsSync(new URL(`../../${repositoryPath}`, import.meta.url)), file);
    const plan = classifyCiRisk(input([repositoryPath]));
    assert.equal(plan.risk, 'installer', file);
    assert.equal(plan.repetitions, 1, file);
    assert.equal(plan.gates.legacyUpgrade, true, file);
    assert.deepEqual(plan.faultScenarios, CI_FAULT_SCENARIOS, file);
  }
  assert.equal(classifyCiRisk(input([path('apps/web/src/features/customers/CustomerForm.tsx')])).risk, 'fast');
  assert.equal(classifyCiRisk(input([path('apps/desktop/src/diagnostics/view.ts')])).gates.legacyUpgrade, false);
});

for (const file of ['apps/desktop/src/update/firstStartUpdateCoordinator.ts',
  'apps/desktop/src/workspaces/registry.ts', 'apps/desktop/src/main/index.ts',
  'apps/desktop/installer/windows-acceptance-harness/workspaceCommandPhase.mjs',
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
