import type {
  ElectronE2eBackendFailureStage,
  ElectronE2eBackendFailureStatus,
} from './electronE2eBackendStatus.js';
import catalog from './electronE2eBackendFailureCatalog.json' with { type: 'json' };

export type ElectronE2eBackendFailureReason = keyof typeof catalog.reasons;
export const electronE2eBackendFailureReasons = Object.freeze(
  Object.keys(catalog.reasons) as ElectronE2eBackendFailureReason[],
);
export type ElectronE2eBackendBroker = keyof typeof catalog.brokers;
export const electronE2eBackendBrokers = Object.freeze(
  Object.keys(catalog.brokers) as ElectronE2eBackendBroker[],
);

export function isElectronE2eBackendFailureReason(value: unknown): value is ElectronE2eBackendFailureReason {
  return electronE2eBackendFailureReasons.some((reason) => reason === value);
}

// Project only exact codes. Never inspect message substrings, stacks or getters.
export function classifyElectronE2eBackendFailure(error: unknown): ElectronE2eBackendFailureReason {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== 'object' || current === null || seen.has(current)) break;
    seen.add(current);
    try {
      const code = Object.getOwnPropertyDescriptor(current, 'code')?.value as unknown;
      if (isElectronE2eBackendFailureReason(code) && code !== 'unknown') return code;
      const message = Object.getOwnPropertyDescriptor(current, 'message')?.value as unknown;
      if (typeof message === 'string' && message.startsWith('ELECTRON_E2E_') &&
          isElectronE2eBackendFailureReason(message)) return message;
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value as unknown;
    } catch {
      break;
    }
  }
  return 'unknown';
}

export function reportElectronE2eBackendFailure(input: {
  error: unknown;
  stage: ElectronE2eBackendFailureStage;
  brokers: Partial<Record<ElectronE2eBackendBroker, { close(): void }>>;
  send(status: ElectronE2eBackendFailureStatus): void;
}): void {
  const reason = classifyElectronE2eBackendFailure(input.error);
  const brokerCleanupFailures: ElectronE2eBackendBroker[] = [];
  for (const name of electronE2eBackendBrokers) {
    try { input.brokers[name]?.close(); } catch { brokerCleanupFailures.push(name); }
  }
  try {
    input.send(Object.freeze({
      type: 'failed', stage: input.stage, reason,
      brokerCleanupFailures: Object.freeze(brokerCleanupFailures),
    }));
  } catch {
    // The parent still owns readiness/exit failure when delivery is unavailable.
  }
}
