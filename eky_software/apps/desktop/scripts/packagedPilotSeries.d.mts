import type { DesktopBuildInfo } from '../src/release/desktopBuildInfo.js';
import type { DesktopReleaseInfo } from '../src/release/desktopReleaseInfo.js';

export const packagedSeriesManifestVariable: 'EKY_PACKAGED_SERIES_MANIFEST_SHA256';
export function requirePackagedSeriesPin(environment?: NodeJS.ProcessEnv): string;
export function inspectPackagedPilotSeries(expectedPin?: string, options?: {
  assertCurrent?: () => void;
}): Promise<Readonly<{
  pin: string;
  buildInfo: Readonly<DesktopBuildInfo>;
  releaseInfo: Readonly<DesktopReleaseInfo>;
  manifest: Readonly<{
    appVersion: string;
    buildRevision: string;
    inventoryIdentity: string;
    inventoryFileCount: number;
    inventoryTotalByteSize: number;
    releaseChannel: 'pilot';
  }>;
}>>;
