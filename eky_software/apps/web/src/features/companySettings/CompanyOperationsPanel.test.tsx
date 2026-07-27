import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { CompanyOperationsPanel } from './CompanyOperationsPanel.js';
import { uiText } from '../../i18n/fi.js';

describe('CompanyOperationsPanel', () => {
  it('offers activity and diagnostics from company settings', () => {
    const html = renderToStaticMarkup(
      <CompanyOperationsPanel
        onOpenActivity={vi.fn()}
        onOpenDiagnostics={vi.fn()}
      />,
    );

    expect(html).toContain(uiText.companySettings.operationsTitle);
    expect(html).toContain(uiText.modules.activity);
    expect(html).toContain(uiText.modules.diagnostics);
    expect(html).toContain('type="button"');
  });
});
