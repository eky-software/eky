import type { BrowserWindow, MessageBoxOptions } from 'electron';

interface WorkspaceReplacementConfirmationOptions {
  readonly mainWindow: BrowserWindow;
  readonly workspaceLabel: string;
  showMessageBox(
    owner: BrowserWindow,
    options: MessageBoxOptions,
  ): Promise<{ response: number }>;
}

export async function confirmActiveWorkspaceReplacement(
  options: Readonly<WorkspaceReplacementConfirmationOptions>,
): Promise<boolean> {
  const result = await options.showMessageBox(options.mainWindow, {
    buttons: ['Peruuta', 'Korvaa tiedot'],
    cancelId: 0,
    defaultId: 0,
    detail:
      'Nykyisistä tiedoista luodaan ensin palautuspiste. Varmuuskopion pitää kuulua täsmälleen samalle yritykselle. Eky käynnistyy uudelleen, jos korvaus onnistuu.',
    message: `Korvataanko yrityksen ${options.workspaceLabel} nykyiset tiedot varmuuskopiosta?`,
    noLink: true,
    title: 'Korvaa aktiivisen yrityksen tiedot',
    type: 'warning',
  });
  return result.response === 1;
}
