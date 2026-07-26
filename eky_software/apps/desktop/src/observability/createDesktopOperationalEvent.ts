import { randomUUID } from 'node:crypto';

import {
  desktopOperationalEventSpecs,
  type DesktopOperationalEvent,
  type DesktopOperationalEventInput,
} from './desktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from './desktopOperationalEventValidator.js';

export function createDesktopOperationalEvent<
  Input extends DesktopOperationalEventInput,
>(
  input: Readonly<Input>,
  options: {
    appVersion: string;
    eventId?: string;
    timestamp?: string;
  },
): Extract<DesktopOperationalEvent, { eventName: Input['eventName'] }> {
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
  }) as Extract<
    DesktopOperationalEvent,
    { eventName: Input['eventName'] }
  >;
}
