import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import commandBudgets from '../windows-process-supervisor/supervisorCommandBudgets.json' with { type: 'json' };
import { cleanupRunContext, createRunContext, startProgramFailureFixture }
  from '../windows-process-supervisor/tests/supervisorContractTestSupport.mjs';
import { CALLER_RESULT_TIMEOUT_MS, CALLER_RESULT_TERMINATION_MS } from './callerResultProcess.mjs';
import { LEGACY_COMMAND_RESERVATION_MS, LEGACY_CONSUMER_JOB_MINUTES,
  LEGACY_LIFECYCLE_STEP_MINUTES, LEGACY_SUPERVISOR_BUILD_MINUTES,
  LEGACY_SUPERVISOR_TIMEOUT_MS, LEGACY_SUPERVISOR_CLEANUP_MS } from './legacyUpgradeBudget.mjs';

test('the real command budget separates work, publication and exit at controlled elapsed times', {
  skip: process.platform !== 'win32', timeout: 30_000,
}, async (t) => {
  const context = await createRunContext('command-budget');
  let verified = false;
  t.after(() => cleanupRunContext(context, { preserveEvidence: !verified }));
  const base = { commandReservation: 20_000, exitReserve: commandBudgets.exitReserveMilliseconds,
    phaseTimeout: 4_000, publicationTimeout: 4_000, publishing: false };
  const workspace = commandBudgets.workspaceCommand;
  const materialization = { commandReservation: workspace.reservationMilliseconds,
    phaseTimeout: workspace.phases.find(([name]) => name === 'materialize')[1],
    publicationTimeout: workspace.phases.at(-1)[1] };
  const cases = [
    { elapsed: 0, expected: 4_000 },
    { elapsed: 3_500, expected: 2_500 },
    { elapsed: 5_000, expected: 1_000 },
    { elapsed: 6_000, expected: 0 },
    { elapsed: 6_001, expected: -1 },
    { elapsed: 6_000, publishing: true, expected: 4_000 },
    { elapsed: 12_000, publishing: true, expected: 3_000 },
    { elapsed: 15_000, publishing: true, expected: 0 },
    { elapsed: 15_001, publishing: true, expected: -1 },
    { commandReservation: commandBudgets.workspaceCommand.reservationMilliseconds, elapsed: 6_000, expected: 4_000 },
    { commandReservation: commandBudgets.legacyCommand.reservationMilliseconds, elapsed: 6_000, expected: 4_000 },
    { ...materialization, elapsed: 1_200_000, expected: 125_000 },
    { ...materialization, elapsed: 1_300_000, expected: 95_000 },
  ];
  await writeFile(context.requestPath, JSON.stringify(cases.map(({ expected, ...input }) => ({ ...base, ...input }))));
  const execution = startProgramFailureFixture(context, 'commandBudget');
  const events = [];
  execution.child.once('exit', () => events.push('exit'));
  execution.child.once('close', () => events.push('close'));
  const result = await execution.completion;
  assert.deepEqual(events, ['exit', 'close']);
  assert.equal(result.signal, null);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(await readFile(join(context.testRoot, 'command-budget-result.json'), 'utf8')),
    cases.map(({ expected }) => expected));
  verified = true;
});

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
