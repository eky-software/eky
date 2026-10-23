export const openOperationalLogFolderIpcChannel =
  'eky:diagnostics:open-operational-log-folder';
export const createSupportBundleIpcChannel =
  'eky:diagnostics:create-support-bundle';
export const getOperationalLogFailureStatusIpcChannel =
  'eky:diagnostics:get-operational-log-failure-status';
export const operationalLogFailureObservedIpcChannel =
  'eky:diagnostics:operational-log-failure-observed';

export type SupportBundleCreationResult = 'cancelled' | 'created';

export interface DesktopDiagnosticsApi {
  getOperationalLogFailureStatus(): Promise<{ failureObserved: boolean }>;
  onOperationalLogFailure(callback: () => void): () => void;
  openOperationalLogFolder(): Promise<void>;
  createSupportBundle(): Promise<SupportBundleCreationResult>;
}
