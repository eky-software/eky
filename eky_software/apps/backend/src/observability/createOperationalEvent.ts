import { randomUUID } from 'node:crypto';

import {
  backendOperationalEventSpecs,
  type BackendOperationalEventFor,
  type BackendOperationalEventName,
  type BackendOperationalEventPayloadMap,
} from './operationalEvent.js';
import { validateBackendOperationalEvent } from './operationalEventValidator.js';

export interface CreateBackendOperationalEventOptions {
  appVersion: string;
  eventId?: string;
  timestamp?: string;
}

export function createBackendOperationalEvent<
  Name extends BackendOperationalEventName,
>(
  input: Readonly<
    { eventName: Name } & BackendOperationalEventPayloadMap[Name]
  >,
  options: CreateBackendOperationalEventOptions,
): BackendOperationalEventFor<Name> {
  const spec = backendOperationalEventSpecs[input.eventName];

  return validateBackendOperationalEvent({
    ...input,
    appVersion: options.appVersion,
    category: spec.category,
    component: 'backend',
    eventId: options.eventId ?? randomUUID(),
    level: spec.level,
    outcome: spec.outcome,
    schemaVersion: 1,
    timestamp: options.timestamp ?? new Date().toISOString(),
  }) as BackendOperationalEventFor<Name>;
}
