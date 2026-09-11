import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };
import { CALLER_RESULT_TIMEOUT_MS, CALLER_RESULT_TERMINATION_MS } from './callerResultProcess.mjs';
import { LEGACY_COMMAND_RESERVATION_MS, LEGACY_CONSUMER_JOB_MINUTES,
  LEGACY_LIFECYCLE_STEP_MINUTES, LEGACY_SUPERVISOR_BUILD_MINUTES,
  LEGACY_SUPERVISOR_TIMEOUT_MS, LEGACY_SUPERVISOR_CLEANUP_MS } from './legacyUpgradeBudget.mjs';

test('legacy lifecycle fits existing process waits plus grouped filesystem and result delivery reservations', () => {
  assert.equal(LEGACY_SUPERVISOR_TIMEOUT_MS, 600_000);
  assert.equal(LEGACY_SUPERVISOR_CLEANUP_MS, 30_000);
  assert.equal(LEGACY_COMMAND_RESERVATION_MS, 1_600_000);
  assert.equal(commandBudgets.legacyCommand.reservationMilliseconds + CALLER_RESULT_TIMEOUT_MS + CALLER_RESULT_TERMINATION_MS,
    LEGACY_COMMAND_RESERVATION_MS);
  assert.deepEqual(commandBudgets.legacyCommand.phases.find(([name]) => name === 'scenario'),
    ['scenario', LEGACY_SUPERVISOR_TIMEOUT_MS, LEGACY_SUPERVISOR_CLEANUP_MS]);
  assert.ok(LEGACY_COMMAND_RESERVATION_MS < LEGACY_LIFECYCLE_STEP_MINUTES * 60_000);
  assert.ok(LEGACY_LIFECYCLE_STEP_MINUTES + LEGACY_SUPERVISOR_BUILD_MINUTES < LEGACY_CONSUMER_JOB_MINUTES);
});

test('legacy consumer separates build time from the bounded lifecycle and preserves mandatory result verification', async () => {
  const source = await readFile(new URL('../../../../../.github/workflows/windows-acceptance-v2-legacy-diagnostic.yml', import.meta.url), 'utf8');
  const consumer = source.slice(source.indexOf('  legacy_consumer:'));
  const build = consumer.slice(consumer.indexOf('      - name: Build legacy consumer supervisor'),
    consumer.indexOf('      - name: Run existing supervised legacy lifecycle once'));
  const lifecycle = consumer.slice(consumer.indexOf('      - name: Run existing supervised legacy lifecycle once'),
    consumer.indexOf('      - name: Reverify phase artifact bytes after lifecycle'));
  assert.ok(consumer.includes(`timeout-minutes: ${LEGACY_CONSUMER_JOB_MINUTES}\n`));
  assert.ok(build.includes(`timeout-minutes: ${LEGACY_SUPERVISOR_BUILD_MINUTES}\n`));
  assert.ok(build.includes('installer:supervisor:build'));
  assert.ok(lifecycle.includes(`timeout-minutes: ${LEGACY_LIFECYCLE_STEP_MINUTES}\n`));
  assert.ok(lifecycle.includes('exec dotnet installer/bin/windows-process-supervisor/Release/net10.0/Eky.WindowsProcessSupervisor.dll --legacy-command'));
  assert.doesNotMatch(lifecycle, /runLegacyUpgrade\.mjs/);
  assert.ok(lifecycle.includes('verifyLegacyCallerResult.mjs'));
  assert.doesNotMatch(lifecycle, /installer:supervisor:build|installer:v2-legacy --|retry|continue-on-error/);
});

test('workspace command reserves mandatory publication within the existing lifecycle step', () => {
  const budget = commandBudgets.workspaceCommand;
  assert.equal(budget.reservationMilliseconds, 1_440_000);
  assert.deepEqual(budget.phases.find(([name]) => name === 'scenario'), ['scenario', 720_000, 30_000]);
  assert.deepEqual(budget.phases.at(-1), ['publish', 35_000, 5_000]);
  assert.ok(budget.reservationMilliseconds + 35_000 < 25 * 60_000);
  assert.equal(new Set(budget.phases.map(([name]) => name)).size, budget.phases.length);
  assert.ok(budget.phases.every(([, timeout, cleanup]) => timeout > cleanup && cleanup >= commandBudgets.exitReserveMilliseconds));
});
