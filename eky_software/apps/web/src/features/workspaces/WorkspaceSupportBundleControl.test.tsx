import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { uiText } from '../../i18n/fi.js';
import { WorkspaceSupportBundleControl } from './WorkspaceSupportBundleControl.js';

describe('WorkspaceSupportBundleControl presentation', () => {
  it.each([true, false])('renders the existing command without starting export (disabled: %s)', disabled => {
    const create = vi.fn();
    const html = renderToStaticMarkup(<WorkspaceSupportBundleControl controller={{ create, disabled, state: 'idle' }} />);
    expect(html).toContain(uiText.diagnostics.createSupportBundle);
    expect(html.includes('disabled=""')).toBe(disabled);
    expect(html).not.toContain(uiText.diagnostics.supportBundleCreated);
    expect(html).not.toContain('role="alert"');
    expect(create).not.toHaveBeenCalled();
  });

  it('wires exactly the admitted controller action to the button', () => {
    const controller = { create: vi.fn(), disabled: false, state: 'idle' as const };
    const view = WorkspaceSupportBundleControl({ controller });
    expect(view.props.children[0].props.onClick).toBe(controller.create);
    expect(controller.create).not.toHaveBeenCalled();
  });
});
