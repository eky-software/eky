import type { StartDesktopBackendOptions } from '../runtime/backendProcess.js';
import type { SecretBrokerMainHandle } from '../secrets/secretBrokerMain.js';

export function createSecretSafeMigrationGate(
  secrets: Pick<SecretBrokerMainHandle, 'sealAndDrain'>,
  beforeMigrations: StartDesktopBackendOptions['beforeMigrations'],
): StartDesktopBackendOptions['beforeMigrations'] {
  return async (inspection, control) => {
    try {
      await beforeMigrations(inspection, {
        async stopStartupRuntime() {
          await secrets.sealAndDrain();
          await control.stopStartupRuntime();
        },
      });
    } catch (error) {
      // The runtime aborts startup after this callback rejects. Seal first;
      // a failed drain stays sticky for composition's separate cleanup gate.
      await secrets.sealAndDrain().catch(() => undefined);
      throw error;
    }
  };
}
