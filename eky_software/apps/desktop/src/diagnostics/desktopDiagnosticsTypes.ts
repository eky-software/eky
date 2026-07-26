export const openOperationalLogFolderIpcChannel =
  'eky:diagnostics:open-operational-log-folder';

export interface DesktopDiagnosticsApi {
  openOperationalLogFolder(): Promise<void>;
}
