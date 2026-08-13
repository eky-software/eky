interface BusinessRuntimeShutdownDependencies {
  stopBackend(): Promise<void>;
  stopRecoveryChecks(): Promise<void>;
}

export interface BusinessRuntimeShutdown {
  stop(): Promise<void>;
}

export function createBusinessRuntimeShutdown(
  dependencies: BusinessRuntimeShutdownDependencies,
): BusinessRuntimeShutdown {
  let stopped = false;
  let activeStop: Promise<void> | undefined;

  return {
    async stop() {
      if (stopped) {
        return;
      }
      if (activeStop !== undefined) {
        return activeStop;
      }

      activeStop = stopBusinessRuntime(dependencies).then(() => {
        stopped = true;
      });
      try {
        await activeStop;
      } finally {
        if (!stopped) {
          activeStop = undefined;
        }
      }
    },
  };
}

async function stopBusinessRuntime(
  dependencies: BusinessRuntimeShutdownDependencies,
): Promise<void> {
  await dependencies.stopRecoveryChecks();
  await dependencies.stopBackend();
}
