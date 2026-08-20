import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { WorkspaceManagementCapability } from '../app/desktopWorkspaceManagement.js';
import { AppLayout } from './AppLayout.js';

describe('AppLayout workspace composition', () => {
  it('keeps ordinary browser layout on the static fallback brand', () => {
    const html = renderToStaticMarkup(
      <AppLayout
        activeView="customers"
        onViewChange={() => undefined}
        title="Asiakkaat"
      >
        <p>Sisältö</p>
      </AppLayout>,
    );

    expect(html).toContain('Sisältö');
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  it('renders a stable loading company selector before desktop status resolves', () => {
    const capability = createCapability();
    const html = renderToStaticMarkup(
      <AppLayout
        activeView="customers"
        onViewChange={() => undefined}
        title="Asiakkaat"
        workspaceManagementCapability={capability}
      >
        <p>Sisältö</p>
      </AppLayout>,
    );

    expect(html).toContain('Ladataan yritystä…');
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).not.toContain('Oma yritys Oy');
  });
});

function createCapability(): WorkspaceManagementCapability {
  return {
    createEmpty: async () => 'completed',
    getStatus: async () => ({
      activeWorkspaceId: null,
      formatVersion: 1,
      operationState: 'idle',
      workspaces: [],
    }),
    importBackupAsNew: async () => 'cancelled',
    rename: async () => 'completed',
    switchTo: async () => 'completed',
  };
}
