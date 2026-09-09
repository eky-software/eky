import assert from 'node:assert/strict';
import { setInterval } from 'node:timers';

const mode = process.argv[2];
assert(['hold', 'unread'].includes(mode));
if (mode === 'hold') setInterval(() => {}, 1000);
else {
  // Saturate an actual unread pipe inside the scenario Job. Deliberate fault,
  // not a readiness signal or a timing-based completion condition.
  const event = JSON.stringify({ schemaVersion: 1, operation: 'historicalLegacyUpgradeLifecycle',
    scenario: 'historicalLegacyUpgrade', phase: 'majorUpgrade', status: 'started',
    durationMs: 0, elapsedMs: 0, resultCode: 'started' });
  for (;;) console.error(event);
}
