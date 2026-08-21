const allowedStartupFailureCodes = new Set([
  'BACKEND_EXITED_BEFORE_READY',
  'BACKEND_READINESS_TIMEOUT',
  'DESKTOP_START_FAILED',
  'DESKTOP_BUILD_ADMISSION_REJECTED',
  'PACKAGED_BUILD_INFO_INVALID',
  'PACKAGED_PACKAGE_MODE_INVALID',
  'PACKAGED_SMOKE_FAILED',
  'PROFILE_MAINTENANCE_BUSY',
  'PROFILE_MAINTENANCE_OPERATION_MISMATCH',
  'PROFILE_MAINTENANCE_TIMEOUT',
  'PROFILE_RESTORE_RECOVERY_REQUIRED',
  'PROFILE_SNAPSHOT_ARTIFACTS_FAILED',
  'PROFILE_SNAPSHOT_BROKER_OPERATION_FAILED',
  'PROFILE_SNAPSHOT_BROKER_REQUEST_INVALID',
  'PROFILE_SNAPSHOT_STAGING_FAILED',
  'PROFILE_SNAPSHOT_BROKER_UNAVAILABLE',
  'PROFILE_SNAPSHOT_DATABASE_FAILED',
  'PROFILE_SNAPSHOT_VALIDATION_FAILED',
  'WORKSPACE_ADOPTION_INVALID',
  'WORKSPACE_ADOPTION_RECOVERY_REQUIRED',
  'WORKSPACE_ADOPTION_STORAGE_FAILED',
  'WORKSPACE_FIRST_START_MIGRATION_FAILED',
  'WORKSPACE_FIRST_START_MIGRATION_RECOVERY_REQUIRED',
  'WORKSPACE_FIRST_START_MIGRATION_ROLLBACK_REQUIRED',
  'WORKSPACE_REGISTRY_BUSY',
  'WORKSPACE_REGISTRY_UNAVAILABLE',
  'WORKSPACE_ROOT_INVALID',
  'WORKSPACE_SWITCH_INVALID',
  'WORKSPACE_SWITCH_RECOVERY_REQUIRED',
  'WORKSPACE_SWITCH_STORAGE_FAILED',
]);

export interface DesktopRuntimeModule<Runtime> {
  startDesktopComposition: Runtime;
}

interface RunSafeDesktopStartupOptions<Runtime> {
  exitApplication(code: number): void;
  loadRuntime(): Promise<DesktopRuntimeModule<Runtime>>;
  onFailure(errorCode: string): Promise<void> | void;
  startRuntime(runtime: Runtime): Promise<void>;
  waitUntilReady(): Promise<void>;
}

export async function runSafeDesktopStartup<Runtime>(
  options: RunSafeDesktopStartupOptions<Runtime>,
): Promise<void> {
  try {
    await options.waitUntilReady();
    const runtimeModule = await options.loadRuntime();
    await options.startRuntime(runtimeModule.startDesktopComposition);
  } catch (error) {
    const errorCode = readSafeStartupFailureCode(error);

    try {
      await options.onFailure(errorCode);
    } catch {
      // Startup reporting must not replace the allowlisted failure path.
    } finally {
      options.exitApplication(1);
    }
  }
}

export function readSafeStartupFailureCode(error: unknown): string {
  return error instanceof Error && isSafeStartupFailureCode(error.message)
    ? error.message
    : 'DESKTOP_START_FAILED';
}

function isSafeStartupFailureCode(value: string): boolean {
  return (
    allowedStartupFailureCodes.has(value) ||
    /^DESKTOP_SMOKE_[A-Z0-9_]{1,80}$/.test(value)
  );
}
