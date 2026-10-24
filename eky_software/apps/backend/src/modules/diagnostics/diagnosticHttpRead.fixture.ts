import assert from 'node:assert/strict';
import type { Hono } from 'hono';

import type { BackendEnvironment } from '../../http/runtimeTrust.js';
import { isDiagnosticBrowseCursor, diagnosticBrowsePolicy } from './domain/diagnosticBrowsePolicy.js';
import type { DiagnosticEventPage, DiagnosticReadyPage } from './domain/diagnosticEventPage.js';

export async function readDiagnosticHttpPageForTest(
  app: Pick<Hono<BackendEnvironment>, 'request'>,
): Promise<DiagnosticReadyPage> {
  let path = '/diagnostics/events';
  for (let step = 0; step <= diagnosticBrowsePolicy.maximumSteps; step++) {
    const response = await app.request(path);
    assert.equal(response.status, 200);
    const result: DiagnosticEventPage = await response.json();
    if (result.state !== 'scanning') {
      assert.equal(result.state, 'ready');
      if (result.state === 'ready') return result;
      throw new Error('Diagnostic test read did not complete.');
    }
    assert.ok(isDiagnosticBrowseCursor(result.cursor));
    path = `/diagnostics/events?cursor=${result.cursor}`;
  }
  throw new Error('Diagnostic test continuation budget exceeded.');
}
