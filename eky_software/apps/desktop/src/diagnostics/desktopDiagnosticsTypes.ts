export const openOperationalLogFolderIpcChannel =
  'eky:diagnostics:open-operational-log-folder';
export const createSupportBundleIpcChannel =
  'eky:diagnostics:create-support-bundle';

export type SupportBundleCreationResult = 'cancelled' | 'created';

export interface DesktopDiagnosticsApi {
  openOperationalLogFolder(): Promise<void>;
  createSupportBundle(): Promise<SupportBundleCreationResult>;
}
