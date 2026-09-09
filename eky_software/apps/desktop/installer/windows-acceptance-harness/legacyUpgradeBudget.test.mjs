import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { LEGACY_COMMAND_RESERVATION_MS, LEGACY_CONSUMER_JOB_MINUTES,
  LEGACY_LIFECYCLE_STEP_MINUTES, LEGACY_SUPERVISOR_BUILD_MINUTES,
  LEGACY_SUPERVISOR_TIMEOUT_MS, LEGACY_SUPERVISOR_CLEANUP_MS } from './legacyUpgradeBudget.mjs';

test('legacy lifecycle fits existing process waits plus grouped filesystem and result delivery reservations', () => {
  assert.equal(LEGACY_SUPERVISOR_TIMEOUT_MS, 600_000);
  assert.equal(LEGACY_SUPERVISOR_CLEANUP_MS, 30_000);
  assert.equal(LEGACY_COMMAND_RESERVATION_MS, 1_540_000);
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
  assert.ok(lifecycle.includes('exec node installer/windows-acceptance-harness/runLegacyUpgrade.mjs'));
  assert.ok(lifecycle.includes('verifyLegacyCallerResult.mjs'));
  assert.doesNotMatch(lifecycle, /installer:supervisor:build|installer:v2-legacy --|retry|continue-on-error/);
});
