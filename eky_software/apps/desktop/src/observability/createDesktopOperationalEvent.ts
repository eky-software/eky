import { randomUUID } from 'node:crypto';

import {
  desktopOperationalEventSpecs,
  type DesktopOperationalEventFor,
  type DesktopOperationalEventName,
  type DesktopOperationalEventPayloadMap,
} from './desktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from './desktopOperationalEventValidator.js';

export function createDesktopOperationalEvent<
  Name extends DesktopOperationalEventName,
>(
  input: Readonly<
    { eventName: Name } & DesktopOperationalEventPayloadMap[Name]
  >,
  options: {
    appVersion: string;
    eventId?: string;
    timestamp?: string;
  },
): DesktopOperationalEventFor<Name> {
  const spec = desktopOperationalEventSpecs[input.eventName];

  return validateDesktopOperationalEvent({
    ...input,
    appVersion: options.appVersion,
    category: spec.category,
    component: 'desktop',
    eventId: options.eventId ?? randomUUID(),
    level: spec.level,
    outcome: spec.outcome,
    schemaVersion: 1,
    timestamp: options.timestamp ?? new Date().toISOString(),
  }) as DesktopOperationalEventFor<Name>;
}
