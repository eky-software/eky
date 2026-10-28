import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from 'electron';

import type { WorkspaceDeletionPreparationOptions } from './workspaceDeletionPreparation.js';

export function createWorkspaceDeletionConfirmations(options: Readonly<{
  getWindow(): BrowserWindow;
  showMessageBox(owner: BrowserWindow, input: MessageBoxOptions): Promise<MessageBoxReturnValue>;
}>): Pick<WorkspaceDeletionPreparationOptions, 'confirmDataLoss' | 'confirmDeletion' | 'confirmReturn'> {
  const confirm = async (input: MessageBoxOptions) => {
    const window = options.getWindow();
    if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
    const result = await options.showMessageBox(window, input);
    if (window.isDestroyed() || window.webContents.isDestroyed()) throw new Error('WORKSPACE_DELETE_AUTHORITY_INVALID');
    return result.response === 1;
  };
  return {
    confirmDataLoss: target => confirm({
      buttons: ['Peruuta', 'Hyväksyn tietojen menetyksen'], cancelId: 0, defaultId: 0, noLink: true,
      title: 'Poisto ilman varmuuskopiota', type: 'warning',
      message: `Hyväksytkö yrityksen ${target.workspaceLabel} tietojen menetyksen?`,
      detail: 'Poistosta ei tehdä piilokopiota. Ilman omaa toimivaa varmuuskopiota tietoja ei voi palauttaa. Tämä ei vielä aloita poistoa.',
    }),
    confirmDeletion: target => confirm({
      buttons: ['Peruuta', 'Poista yritys pysyvästi'], cancelId: 0, defaultId: 0, noLink: true,
      title: 'Vahvista yrityksen poisto', type: 'warning',
      message: `Poistetaanko yritys ${target.workspaceLabel} pysyvästi?`,
      detail: 'Yrityksen tiedot, asetukset, SMTP-salasana ja omat palautuspisteet poistetaan. Itse tallentamasi varmuuskopiot ja ulkoiset PDF-kopiot säilyvät.',
    }),
    confirmReturn: target => confirm({
      buttons: ['Jää tähän', 'Palaa'], cancelId: 0, defaultId: 0, noLink: true,
      title: 'Yrityksen poisto peruttiin', type: 'question',
      message: target.previousActiveWorkspaceId === null ? 'Palataanko yritysvalintaan?' : 'Palataanko aiempaan yritykseen?',
      detail: 'Yrityksen tietoja ei poistettu. Paluu avaa EKYn uudelleen vasta turvallisen sulun tarkistusten jälkeen.',
    }),
  };
}
