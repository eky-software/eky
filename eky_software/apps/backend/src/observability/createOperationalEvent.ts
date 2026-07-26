import { randomUUID } from 'node:crypto';

import {
  backendOperationalEventSpecs,
  type BackendOperationalEvent,
  type BackendOperationalEventInput,
} from './operationalEvent.js';
import { validateBackendOperationalEvent } from './operationalEventValidator.js';

export interface CreateBackendOperationalEventOptions {
  appVersion: string;
  eventId?: string;
  timestamp?: string;
}

export function createBackendOperationalEvent<
  Input extends BackendOperationalEventInput,
>(
  input: Readonly<Input>,
  options: CreateBackendOperationalEventOptions,
): Extract<BackendOperationalEvent, { eventName: Input['eventName'] }> {
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
  }) as Extract<
    BackendOperationalEvent,
    { eventName: Input['eventName'] }
  >;
}
