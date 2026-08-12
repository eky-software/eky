import type { BrowserWindow, MessageBoxOptions } from 'electron';

import type { LocalUpdateStatus } from './localUpdateSelectionTypes.js';

export const unsignedPilotUpdateWarning =
  'Tämän pilot-päivityksen julkaisijaa ei ole varmennettu Windowsin digitaalisella allekirjoituksella. Jatka vain, jos päivityspaketti on saatu suoraan Eky-kehittäjältä hallitulla medialla.';

interface LocalUpdateConfirmationOptions {
  mainWindow: BrowserWindow;
  showMessageBox(
    owner: BrowserWindow,
    options: MessageBoxOptions,
  ): Promise<{ response: number }>;
  status: Readonly<LocalUpdateStatus>;
}

export async function confirmLocalUpdateWithNativeDialog(
  options: LocalUpdateConfirmationOptions,
): Promise<boolean> {
  const candidate = options.status.candidate;
  if (candidate === null) {
    return false;
  }
  const result = await options.showMessageBox(options.mainWindow, {
    buttons: ['Jatka päivitykseen', 'Peruuta'],
    cancelId: 1,
    defaultId: 1,
    detail: [
      `Nykyinen sovellusversio: ${options.status.current.appVersion}`,
      `Kohdesovellusversio: ${candidate.appVersion}`,
      `Nykyinen MSI-versio: ${options.status.current.msiProductVersion}`,
      `Kohde-MSI-versio: ${candidate.msiProductVersion}`,
      `Julkaisukanava: ${candidate.releaseChannel}`,
      `Arkkitehtuuri: ${options.status.architecture}`,
      `Paketin SHA-256-tunniste: ${candidate.packageFingerprint}`,
      `Palautuspaketti: ${options.status.currentRollbackPackage === 'ready' ? 'valmis' : 'puuttuu'}`,
      'Päivitystä edeltävä palautuspiste: luodaan hyväksymisen jälkeen',
      '',
      unsignedPilotUpdateWarning,
    ].join('\n'),
    message: 'Asennetaanko valittu paikallinen Eky-päivitys?',
    noLink: true,
    title: 'Vahvista Eky-päivitys',
    type: 'warning',
  });
  return result.response === 0;
}
