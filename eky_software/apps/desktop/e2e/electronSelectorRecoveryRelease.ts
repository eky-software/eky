import type { DesktopReleaseInfo } from '../src/release/desktopReleaseInfo.js';

export const selectorRecoveryScenarioId = 'DESK-SELECTOR-RETURN-001';

// Synthetic identity matching the registry-only fixture. Production build
// admission still runs; ordinary development scenarios retain no release input.
export function readSelectorRecoveryRelease(scenarioId: string): Readonly<DesktopReleaseInfo> | undefined {
  if (scenarioId !== selectorRecoveryScenarioId) return undefined;
  return Object.freeze({
    schemaVersion: 1, appIdentity: 'Eky', appVersion: '0.2.0',
    architecture: 'x64', platform: 'win32', releaseChannel: 'pilot',
    buildRevision: 'a'.repeat(40), msiProductVersion: '0.2.0',
    upgradeCode: '11111111-1111-4111-8111-111111111111',
  });
}
