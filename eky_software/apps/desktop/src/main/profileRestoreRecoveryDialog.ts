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

  await (options.ensureDirectory ?? ensureDirectory)(options.logsRoot);
  await options.openPath(options.logsRoot);
}

async function ensureDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
}
