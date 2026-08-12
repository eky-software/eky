import { createDesktopOperationalEvent } from '../observability/createDesktopOperationalEvent.js';
import type {
  DesktopOperationalEventInput,
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
  operationStateChanged?(input: {
    correlationId: string;
    state: 'accepted' | 'installerNotApplied' | 'recoveryRequired';
    stage: UpdateOperationalStage;
  }): void;
}

export const noOpUpdateOperationalObserver: UpdateOperationalObserver = {
  operationCompleted() {},
  operationFailed() {},
  operationStarted() {},
  operationStateChanged() {},
};

export function createUpdateOperationalObserver(options: {
  identity: Readonly<DesktopOperationalIdentity>;
  logger: DesktopOperationalLogger;
}): UpdateOperationalObserver {
  return {
    operationCompleted(input) {
      writeUpdateEvent(options, {
        eventName: updateEventNames[input.stage].succeeded,
        ...input,
      });
    },
    operationFailed(input) {
      writeUpdateEvent(options, {
        eventName: updateEventNames[input.stage].failed,
        ...input,
      });
    },
    operationStarted(input) {
      writeUpdateEvent(options, {
        eventName: updateEventNames[input.stage].started,
        ...input,
      });
    },
    operationStateChanged(input) {
      writeUpdateEvent(options, {
        correlationId: input.correlationId,
        eventName: `update.${input.state}`,
        stage: input.stage,
        ...(input.state === 'recoveryRequired'
          ? {
              durationMs: 0,
              errorCode: 'UPDATE_RECOVERY_REQUIRED',
              retryable: false,
              sideEffectState: 'unknown' as const,
            }
          : {}),
      });
    },
  };
}

const updateEventNames = Object.freeze({
  binaryRollback: eventFamily('binaryRollback'),
  businessRollback: eventFamily('businessRollback'),
  candidateDiscard: eventFamily('candidateDiscard'),
  confirmation: eventFamily('confirmation'),
  currentPackageRegistration: eventFamily('currentPackageRegistration'),
  firstStartValidation: eventFamily('firstStartValidation'),
  installerHandoff: eventFamily('installerHandoff'),
  packageInspection: eventFamily('packageInspection'),
  packageStaging: eventFamily('packageStaging'),
  recoveryPoint: eventFamily('recoveryPoint'),
  restoreCompatibility: eventFamily('restoreCompatibility'),
  runtimeShutdown: eventFamily('runtimeShutdown'),
} satisfies Record<UpdateOperationalStage, UpdateEventFamily>);

interface UpdateEventFamily {
  failed: `update.${string}Failed`;
  started: `update.${string}Started`;
  succeeded: `update.${string}Succeeded`;
}

function eventFamily(name: string): UpdateEventFamily {
  return Object.freeze({
    failed: `update.${name}Failed`,
    started: `update.${name}Started`,
    succeeded: `update.${name}Succeeded`,
  });
}

function writeUpdateEvent(
  options: {
    identity: Readonly<DesktopOperationalIdentity>;
    logger: DesktopOperationalLogger;
  },
  event: Readonly<Record<string, unknown>>,
): void {
  try {
    options.logger.write(
      createDesktopOperationalEvent<DesktopOperationalEventInput>(
        event as DesktopOperationalEventInput,
        options.identity,
      ),
    );
  } catch {
    // Operational logging must never control update or rollback state.
  }
}
