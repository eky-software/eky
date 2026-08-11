import type { LocalUpdatePackageSummary } from './localUpdatePackageCache.js';

export const selectLocalUpdateIpcChannel = 'eky:update:select-local';

export type LocalUpdateSelectionResult =
  | Readonly<{ status: 'cancelled' }>
  | Readonly<{
      package: Readonly<LocalUpdatePackageSummary>;
      status: 'candidateReady' | 'currentRegistered';
    }>;

