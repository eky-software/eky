const allowedStartupFailureCodes = new Set([
  'BACKEND_EXITED_BEFORE_READY',
  'BACKEND_READINESS_TIMEOUT',
  'DESKTOP_START_FAILED',
  'PACKAGED_SMOKE_FAILED',
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
  return error instanceof Error &&
    allowedStartupFailureCodes.has(error.message)
    ? error.message
    : 'DESKTOP_START_FAILED';
}
