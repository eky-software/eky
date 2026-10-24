import { onTestFinished } from 'vitest';

import { diagnosticBrowsePolicy } from '../domain/diagnosticBrowsePolicy.js';
import type { DiagnosticEventPage } from '../domain/diagnosticEventPage.js';
import { emptyDiagnosticEventReader as unconfiguredReader,
  FileSystemDiagnosticEventReader as ProductionReader } from './fileSystemDiagnosticEventReader.js';

type DiagnosticEventReadResult = Pick<Exclude<DiagnosticEventPage, { state: 'scanning' }>,
  'diagnosticEvents' | 'readState'>;

// Existing projection tests consume a completed page through the real browser.
export class FileSystemDiagnosticEventReader extends ProductionReader {
  constructor(...args: ConstructorParameters<typeof ProductionReader>) {
    super(...args);
    onTestFinished(() => this.close());
  }

  async listRecentDiagnosticEvents(limit: number): Promise<DiagnosticEventReadResult> {
    let result = await this.browseDiagnosticEvents({ limit }, 'synthetic-diagnostic-reader');
    for (let step = 0; result.state === 'scanning' && step < diagnosticBrowsePolicy.maximumSteps; step++) {
      result = await this.browseDiagnosticEvents({ cursor: result.cursor }, 'synthetic-diagnostic-reader');
    }
    if (result.state === 'scanning') throw new Error('Diagnostic fixture continuation budget exceeded.');
    return { diagnosticEvents: result.diagnosticEvents, readState: result.readState };
  }
}

export const emptyDiagnosticEventReader = {
  async listRecentDiagnosticEvents(_limit: number): Promise<DiagnosticEventReadResult> {
    const result = await unconfiguredReader.browseDiagnosticEvents();
    if (result.state !== 'unavailable') throw new Error('Diagnostic fixture source must be unconfigured.');
    return { diagnosticEvents: result.diagnosticEvents, readState: result.readState };
  },
};
