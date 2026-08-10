import { mkdir } from 'node:fs/promises';

interface RecoveryDialogResult {
  response: number;
}

interface ProfileRestoreRecoveryDialogOptions {
  logsRoot: string;
  ensureDirectory?(path: string): Promise<void>;
  openPath(path: string): Promise<string>;
  showMessageBox(options: {
    buttons: string[];
    cancelId: number;
    defaultId: number;
    detail: string;
    message: string;
    noLink: boolean;
    title: string;
    type: 'error';
  }): Promise<RecoveryDialogResult>;
}

export async function showProfileRestoreRecoveryDialog(
  options: ProfileRestoreRecoveryDialogOptions,
): Promise<void> {
  const result = await options.showMessageBox({
    buttons: ['Sulje', 'Avaa lokikansio'],
    cancelId: 0,
    defaultId: 0,
    detail:
      'Eky ei avaa yritystietoja ennen tilanteen tarkistamista. Älä poista tai muokkaa Eky-tiedostoja käsin. Ota yhteys luotettuun tukeen ja toimita lokit vain turvallista kanavaa käyttäen.',
    message:
      'Varmuuskopion palautusta ei voitu viimeistellä tai perua turvallisesti.',
    noLink: true,
    title: 'Palautus vaatii tarkistuksen',
    type: 'error',
  });

  if (result.response !== 1) {
    return;
  }

  while (!(await tryOpenLogsRoot(options))) {
    const retryResult = await options.showMessageBox({
      buttons: ['Sulje', 'Yritä uudelleen'],
      cancelId: 0,
      defaultId: 0,
      detail:
        'Eky ei avaa yritystietoja ennen tilanteen tarkistamista. Voit yrittää lokikansion avaamista uudelleen tai sulkea sovelluksen.',
      message: 'Lokikansiota ei voitu avata.',
      noLink: true,
      title: 'Lokikansiota ei voitu avata',
      type: 'error',
    });

    if (retryResult.response !== 1) {
      return;
    }
  }
}

async function tryOpenLogsRoot(
  options: ProfileRestoreRecoveryDialogOptions,
): Promise<boolean> {
  try {
    await (options.ensureDirectory ?? ensureDirectory)(options.logsRoot);
    return (await options.openPath(options.logsRoot)).length === 0;
  } catch {
    return false;
  }
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
}
