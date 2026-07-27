import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { RuntimeDiagnosticSummaryView } from './RuntimeDiagnosticSummaryView.js';

describe('RuntimeDiagnosticSummaryView', () => {
  it('renders safe release and runtime identity without local paths', () => {
    const html = renderToStaticMarkup(
      <RuntimeDiagnosticSummaryView summary={createSummary()} />,
    );

    expect(html).toContain('0.1.0-alpha.1');
    expect(html).toContain('abcdef123456');
    expect(html).toContain('runtime-instance-1');
    expect(html).toContain('42 migraatiota');
    expect(html).not.toContain('C:\\Users');
    expect(html).not.toContain('runtimeSession');
  });

  it('treats missing file logs as a normal browser development state', () => {
    const html = renderToStaticMarkup(
      <RuntimeDiagnosticSummaryView
        summary={{
          ...createSummary(),
          latestErrorAt: null,
          latestSecurityEventAt: null,
          latestWarningAt: null,
          operationalLogNewestMonth: null,
          operationalLogOldestMonth: null,
          operationalLogsAvailable: false,
          operationalLogTotalBytes: 0,
        }}
      />,
    );

    expect(html).toContain(
      'Tekniset tiedostolokit ovat käytettävissä paketoidussa desktopissa.',
    );
    expect(html).not.toContain('role="alert"');
  });
});

function createSummary() {
  return {
    appVersion: '0.1.0-alpha.1',
    appliedMigrationCount: 42,
    architecture: 'x64',
    buildCreatedAt: '2026-07-28T12:00:00.000Z',
    buildDirty: false,
    buildRevision: 'abcdef123456',
    databaseHealth: 'ok' as const,
    electronVersion: '42.7.0',
    latestErrorAt: '2026-07-28T12:10:00.000Z',
    latestMigrationName: '042_example.sql',
    latestSecurityEventAt: '2026-07-28T12:20:00.000Z',
    latestWarningAt: '2026-07-28T12:05:00.000Z',
    nodeVersion: 'v24.11.0',
    operationalLogNewestMonth: '2026-07',
    operationalLogOldestMonth: '2026-06',
    operationalLogsAvailable: true,
    operationalLogTotalBytes: 4_096,
    platform: 'win32',
    runtimeInstanceId: 'runtime-instance-1',
  };
}
