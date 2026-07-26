import { appendFileSync } from 'node:fs';

import type { BackendOperationalEvent } from '../operationalEvent.js';
import { validateBackendOperationalEvent } from '../operationalEventValidator.js';
import type { OperationalLogger } from '../operationalLogger.js';
import {
  selectMonthlyOperationalLogFile,
  type BackendOperationalLogStream,
} from './operationalLogFiles.js';

export interface OperationalLogFailureSink {
  recordFailure(input: {
    errorCode: 'LOG_CAPACITY_REACHED' | 'LOG_WRITE_FAILED';
    stream: BackendOperationalLogStream;
  }): void;
}

const noOpFailureSink: OperationalLogFailureSink = Object.freeze({
  recordFailure() {},
});

export class JsonLineOperationalLogger implements OperationalLogger {
  readonly #failureSink: OperationalLogFailureSink;
  readonly #logsRoot: string;

  constructor(options: {
    failureSink?: OperationalLogFailureSink;
    logsRoot: string;
  }) {
    this.#failureSink = options.failureSink ?? noOpFailureSink;
    this.#logsRoot = options.logsRoot;
  }

  write(event: BackendOperationalEvent): void {
    let stream: BackendOperationalLogStream = 'backend-warning-error';

    try {
      const validated = validateBackendOperationalEvent(event);
      stream = selectStream(validated);
      const line = `${JSON.stringify(validated)}\n`;
      const selection = selectMonthlyOperationalLogFile({
        lineByteCount: Buffer.byteLength(line, 'utf8'),
        logsRoot: this.#logsRoot,
        month: validated.timestamp.slice(0, 7),
        stream,
      });

      if (selection.outcome === 'capacityReached') {
        this.#recordFailureSafely('LOG_CAPACITY_REACHED', stream);
        return;
      }

      appendFileSync(selection.filePath, line, {
        encoding: 'utf8',
        flag: 'a',
        mode: 0o600,
      });
    } catch {
      this.#recordFailureSafely('LOG_WRITE_FAILED', stream);
    }
  }

  #recordFailureSafely(
    errorCode: 'LOG_CAPACITY_REACHED' | 'LOG_WRITE_FAILED',
    stream: BackendOperationalLogStream,
  ): void {
    try {
      this.#failureSink.recordFailure({ errorCode, stream });
    } catch {
      // Logging failures must not recurse or change business outcomes.
    }
  }
}

function selectStream(
  event: BackendOperationalEvent,
): BackendOperationalLogStream {
  if (
    event.category === 'authorization' ||
    event.category === 'security'
  ) {
    return 'backend-security';
  }

  return event.level === 'info' ? 'backend-info' : 'backend-warning-error';
}
