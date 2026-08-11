import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type {
  DesktopOperationalIdentity,
  UpdateOperationalStage,
} from '../observability/desktopOperationalEvent.js';
import type { DesktopOperationalLogger } from '../observability/desktopOperationalLogger.js';

export interface UpdateOperationalObserver {
  operationCompleted(input: {
    correlationId: string;
    durationMs: number;
    stage: UpdateOperationalStage;
  }): void;
  operationFailed(input: {
    correlationId: string;
    durationMs: number;
    errorCode: string;
    retryable: boolean;
    sideEffectState: 'committed' | 'none' | 'unknown';
    stage: UpdateOperationalStage;
  }): void;
  operationStarted(input: {
    correlationId: string;
    stage: UpdateOperationalStage;
  }): void;
}

export const noOpUpdateOperationalObserver: UpdateOperationalObserver = {
  operationCompleted() {},
  operationFailed() {},
  operationStarted() {},
};

export function createUpdateOperationalObserver(options: {
  identity: Readonly<DesktopOperationalIdentity>;
  logger: DesktopOperationalLogger;
}): UpdateOperationalObserver {
  return {
    operationCompleted(input) {
      options.logger.write(
        createDesktopOperationalEvent(
          { eventName: 'update.operationCompleted', ...input },
          options.identity,
        ),
      );
    },
    operationFailed(input) {
      options.logger.write(
        createDesktopOperationalEvent(
          { eventName: 'update.operationFailed', ...input },
          options.identity,
        ),
      );
    },
    operationStarted(input) {
      options.logger.write(
        createDesktopOperationalEvent(
          { eventName: 'update.operationStarted', ...input },
          options.identity,
        ),
      );
    },
  };
}
