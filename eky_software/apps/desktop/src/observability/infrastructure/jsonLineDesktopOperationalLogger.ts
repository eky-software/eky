import { appendFileSync } from 'node:fs';

import type { DesktopOperationalEvent } from '../desktopOperationalEvent.js';
import { validateDesktopOperationalEvent } from '../desktopOperationalEventValidator.js';
import type { DesktopOperationalLogger } from '../desktopOperationalLogger.js';
import {
  selectDesktopOperationalLogFile,
  type DesktopOperationalLogStream,
} from './desktopOperationalLogFiles.js';

export interface DesktopLogFailureSink {
  recordFailure(input: {
    errorCode: 'LOG_CAPACITY_REACHED' | 'LOG_WRITE_FAILED';
    stream: DesktopOperationalLogStream;
  }): void;
}

const noOpFailureSink: DesktopLogFailureSink = Object.freeze({
  recordFailure() {},
});

export class JsonLineDesktopOperationalLogger
  implements DesktopOperationalLogger
{
  readonly #failureSink: DesktopLogFailureSink;
  readonly #logsRoot: string;

  constructor(options: {
    failureSink?: DesktopLogFailureSink;
    logsRoot: string;
  }) {
    this.#failureSink = options.failureSink ?? noOpFailureSink;
    this.#logsRoot = options.logsRoot;
  }

  write(event: DesktopOperationalEvent): void {
    let stream: DesktopOperationalLogStream = 'desktop-warning-error';

    try {
      const validated = validateDesktopOperationalEvent(event);
      stream = selectStream(validated);
      const line = `${JSON.stringify(validated)}\n`;
      const selection = selectDesktopOperationalLogFile({
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
    stream: DesktopOperationalLogStream,
  ): void {
    try {
      this.#failureSink.recordFailure({ errorCode, stream });
    } catch {
      // Logging failures must not recurse or change runtime behavior.
    }
  }
}

function selectStream(
  event: DesktopOperationalEvent,
): DesktopOperationalLogStream {
  if (event.category === 'security') {
    return 'desktop-security';
  }
  return event.level === 'info' ? 'desktop-info' : 'desktop-warning-error';
}
