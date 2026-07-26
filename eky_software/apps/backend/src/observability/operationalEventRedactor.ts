import type { BackendOperationalEvent } from './operationalEvent.js';
import {
  OperationalEventValidationError,
  validateBackendOperationalEvent,
} from './operationalEventValidator.js';

export interface OperationalEventRedactionResult {
  event?: BackendOperationalEvent;
  outcome: 'accepted' | 'rejected';
}

export function redactBackendOperationalEvent(
  value: unknown,
): OperationalEventRedactionResult {
  try {
    return {
      event: validateBackendOperationalEvent(value),
      outcome: 'accepted',
    };
  } catch (error) {
    if (!(error instanceof OperationalEventValidationError)) {
      return { outcome: 'rejected' };
    }

    return { outcome: 'rejected' };
  }
}
