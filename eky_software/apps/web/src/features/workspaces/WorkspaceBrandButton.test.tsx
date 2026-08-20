import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceBrandButton } from './WorkspaceBrandButton.js';

describe('WorkspaceBrandButton', () => {
  it('renders the active company and local Eky identity as one accessible button', () => {
    const onOpen = vi.fn();
    const element = WorkspaceBrandButton({
      activeWorkspaceLabel: 'Oma yritys Oy',
      brandState: 'idle',
      isCollapsed: false,
      isDialogOpen: false,
      onOpenWorkspaceManagement: onOpen,
      workspaceManagementAvailable: true,
    });
    const html = renderToStaticMarkup(element);

    expect(element.type).toBe('button');
    expect(html).toContain('Oma yritys Oy');
    expect(html).toContain('Eky · Paikallinen');
    expect(html).toContain(
      'aria-label="Vaihda yritystä. Aktiivinen yritys: Oma yritys Oy"',
    );
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-expanded="false"');
    (element.props as { onClick(): void }).onClick();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('keeps the collapsed E logo as the same labelled company selector', () => {
    const onOpen = vi.fn();
    const element = WorkspaceBrandButton({
      activeWorkspaceLabel: 'Pitkä paikallinen yritysnimi',
      brandState: 'idle',
      isCollapsed: true,
      isDialogOpen: true,
      onOpenWorkspaceManagement: onOpen,
      workspaceManagementAvailable: true,
    });
    const html = renderToStaticMarkup(element);

    expect(element.type).toBe('button');
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain(
      'title="Vaihda yritystä. Aktiivinen yritys: Pitkä paikallinen yritysnimi"',
    );
    (element.props as { onClick(): void }).onClick();
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('keeps browser fallback static without a false company selector', () => {
    const html = renderToStaticMarkup(
      <WorkspaceBrandButton
        activeWorkspaceLabel="Eky"
        brandState="browserFallback"
        isCollapsed={false}
        isDialogOpen={false}
        onOpenWorkspaceManagement={() => undefined}
        workspaceManagementAvailable={false}
      />,
    );

    expect(html).not.toContain('<button');
    expect(html).not.toContain('▾');
    expect(html).toContain('Eky');
    expect(html).toContain('Paikallinen');
  });

  it.each([
    ['loading', 'Ladataan yritystä…'],
    ['busy', 'Toiminto käynnissä…'],
    ['recoveryRequired', 'Työtila vaatii huoltoa'],
  ] as const)('shows the safe %s secondary state', (brandState, label) => {
    const html = renderToStaticMarkup(
      <WorkspaceBrandButton
        activeWorkspaceLabel={brandState === 'loading' ? 'Eky' : 'Oma yritys Oy'}
        brandState={brandState}
        isCollapsed={false}
        isDialogOpen={false}
        onOpenWorkspaceManagement={() => undefined}
        workspaceManagementAvailable
      />,
    );

    expect(html).toContain(label);
    if (brandState === 'loading') expect(html).not.toContain('Oma yritys Oy');
  });
});
