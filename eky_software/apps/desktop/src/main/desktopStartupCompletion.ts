import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type { DesktopOperationalIdentity } from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';
import {
  assertW6b2PackagedFaultSessionProbe,
  type W6b2PackagedProofConfiguration,
  type W6b2PackagedProofResult,
} from './w6b2PackagedProof.js';

interface DesktopStartupEventOptions {
  readonly identity: DesktopOperationalIdentity;
  readonly logger: DesktopOperationalLogger;
  readonly startedAt: number;
}

export function reportDesktopStarted(options: DesktopStartupEventOptions): void {
  options.logger.write(
    createDesktopOperationalEvent(
      {
        durationMs: Date.now() - options.startedAt,
        eventName: 'desktop.started',
      },
      options.identity,
    ),
  );
}

export async function runPackagedDesktopStartupProof(
  options: DesktopStartupEventOptions & {
    readonly configuration: Readonly<W6b2PackagedProofConfiguration>;
    readonly controllerAvailable: boolean;
    validateSession(
      configuration: Readonly<W6b2PackagedProofConfiguration>,
    ): Promise<void>;
    runController(): Promise<W6b2PackagedProofResult>;
  },
): Promise<W6b2PackagedProofResult> {
  if (options.configuration.controlFormatVersion === 1) {
    await options.validateSession(options.configuration);
    if (
      options.controllerAvailable &&
      options.configuration.sessionProbeNonce !== undefined
    ) {
      reportDesktopStarted(options);
    }
  } else if (options.configuration.sessionProbeNonce !== undefined) {
    assertW6b2PackagedFaultSessionProbe(options.configuration);
    if (!options.controllerAvailable) {
      throw new Error('W6B2_PROOF_SESSION_VALIDATION_FAILED');
    }
    await options.validateSession(options.configuration);
  }
  return options.runController();
}
