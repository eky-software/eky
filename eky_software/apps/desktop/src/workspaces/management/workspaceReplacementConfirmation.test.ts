import { describe, expect, it, vi } from 'vitest';

import { confirmActiveWorkspaceReplacement } from './workspaceReplacementConfirmation.js';

describe('active workspace replacement confirmation', () => {
  it('keeps cancel as the native default and names only the validated workspace', async () => {
    const mainWindow = {};
    const showMessageBox = vi.fn(async () => ({ response: 0 }));

    await expect(
      confirmActiveWorkspaceReplacement({
        mainWindow: mainWindow as never,
        showMessageBox,
        workspaceLabel: 'Oma yritys Oy',
      }),
    ).resolves.toBe(false);

    expect(showMessageBox).toHaveBeenCalledWith(mainWindow, {
      buttons: ['Peruuta', 'Korvaa tiedot'],
      cancelId: 0,
      defaultId: 0,
      detail:
        'Nykyisistä tiedoista luodaan ensin palautuspiste. Varmuuskopion pitää kuulua täsmälleen samalle yritykselle. Eky käynnistyy uudelleen, jos korvaus onnistuu.',
      message:
        'Korvataanko yrityksen Oma yritys Oy nykyiset tiedot varmuuskopiosta?',
      noLink: true,
      title: 'Korvaa aktiivisen yrityksen tiedot',
      type: 'warning',
    });
  });

  it('accepts only the explicit destructive button response', async () => {
    const mainWindow = {};
    await expect(
      confirmActiveWorkspaceReplacement({
        mainWindow: mainWindow as never,
        showMessageBox: async () => ({ response: 1 }),
        workspaceLabel: 'Oma yritys Oy',
      }),
    ).resolves.toBe(true);
    await expect(
      confirmActiveWorkspaceReplacement({
        mainWindow: mainWindow as never,
        showMessageBox: async () => ({ response: 2 }),
        workspaceLabel: 'Oma yritys Oy',
      }),
    ).resolves.toBe(false);
  });
});
