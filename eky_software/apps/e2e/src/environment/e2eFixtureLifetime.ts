export interface E2eFixtureLifetime {
  readRemainingWorkMilliseconds(): number;
}

// This is an owner-containment ceiling, not Playwright's remaining test time.
// The same instance is passed through setup, sibling launches and restarts.
export function createE2eFixtureLifetime(
  timeoutMilliseconds: number,
  now: () => number = () => performance.now(),
): E2eFixtureLifetime {
  if (!Number.isSafeInteger(timeoutMilliseconds) ||
    timeoutMilliseconds <= 0 || timeoutMilliseconds > 2_147_483_647) {
    throw new Error('E2E_FIXTURE_LIFETIME_INPUT_INVALID');
  }
  let started: number;
  try { started = now(); }
  catch { throw new Error('E2E_FIXTURE_LIFETIME_CLOCK_INVALID'); }
  if (!Number.isFinite(started) || started < 0) {
    throw new Error('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
  }
  let previous = started;
  let clockFailed = false;

  return Object.freeze({
    readRemainingWorkMilliseconds() {
      if (clockFailed) throw new Error('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
      let current: number;
      try { current = now(); }
      catch {
        clockFailed = true;
        throw new Error('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
      }
      if (!Number.isFinite(current) || current < previous) {
        clockFailed = true;
        throw new Error('E2E_FIXTURE_LIFETIME_CLOCK_INVALID');
      }
      previous = current;
      return Math.max(0, Math.floor(timeoutMilliseconds - (current - started)));
    },
  });
}
