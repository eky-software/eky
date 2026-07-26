import type { BackendOperationalEvent } from './operationalEvent.js';

export interface OperationalLogger {
  write(event: BackendOperationalEvent): void;
}

export const noOpOperationalLogger: OperationalLogger = Object.freeze({
  write() {},
});
