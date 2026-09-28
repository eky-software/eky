import type { OperationalLogger } from '../src/observability/operationalLogger.js';

type MigrationEventName = 'migration.started' | 'migration.completed' | 'migration.failed';
type LogWritePhase = 'entered' | 'returned' | 'threw';
export type E2eStartupLogStage = `${MigrationEventName}.log.${LogWritePhase}`;
export type E2eStartupLogObserver = (stage: E2eStartupLogStage) => void;

export function observeE2eStartupLogs(
  delegate: OperationalLogger,
  observe?: E2eStartupLogObserver,
): OperationalLogger {
  if (observe === undefined) return delegate;

  const record = (eventName: MigrationEventName, phase: LogWritePhase): void => {
    try {
      observe(`${eventName}.log.${phase}`);
    } catch {
      // Optional evidence must not replace the logger's result or thrown value.
    }
  };

  return Object.freeze({
    write(event) {
      const eventName = event.eventName;
      if (eventName !== 'migration.started' &&
          eventName !== 'migration.completed' &&
          eventName !== 'migration.failed') {
        delegate.write(event);
        return;
      }

      record(eventName, 'entered');
      try {
        delegate.write(event);
      } catch (error) {
        record(eventName, 'threw');
        throw error;
      }
      record(eventName, 'returned');
    },
  } satisfies OperationalLogger);
}
