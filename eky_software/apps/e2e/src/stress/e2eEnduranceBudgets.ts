export const E2E_ENDURANCE_TIMEOUT_MILLISECONDS = 15 * 60_000;
export const ELECTRON_E2E_ENDURANCE_TIMEOUT_MILLISECONDS = 20 * 60_000;
export const ELECTRON_E2E_SOAK_RESERVE_MILLISECONDS = 5 * 60_000;

export function readDesktopSoakDurationMilliseconds(rawValue?: string): number {
  const durationMinutes = Number(rawValue ?? '30');
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) {
    throw new Error('Desktop soak duration must be 1-240 whole minutes.');
  }
  return durationMinutes * 60_000;
}
