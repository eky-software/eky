const { ipcRenderer } = require('electron') as typeof import('electron');

const submitChannel = 'eky:profile-backup-password:submit';
const cancelChannel = 'eky:profile-backup-password:cancel';
const operationPrefix = '--eky-backup-password-operation=';
const modePrefix = '--eky-backup-password-mode=';

const operationId = readArgument(operationPrefix);
const mode = readArgument(modePrefix);

if (
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    operationId,
  ) ||
  (mode !== 'create' && mode !== 'enter')
) {
  throw new Error('BACKUP_PASSWORD_WINDOW_CONFIGURATION_INVALID');
}

window.addEventListener('DOMContentLoaded', () => {
  const form = requireElement<HTMLFormElement>('password-form');
  const password = requireElement<HTMLInputElement>('password');
  const confirmation = requireElement<HTMLInputElement>('confirmation');
  const confirmationGroup =
    requireElement<HTMLElement>('confirmation-group');
  const title = requireElement<HTMLElement>('title');
  const description = requireElement<HTMLElement>('description');
  const hint = requireElement<HTMLElement>('hint');
  const error = requireElement<HTMLElement>('error');
  const cancel = requireElement<HTMLButtonElement>('cancel');
  const submit = requireElement<HTMLButtonElement>('submit');

  if (mode === 'create') {
    title.textContent = 'Suojaa varmuuskopio salasanalla';
    description.textContent =
      'Kirjoita vähintään 16 merkin salasana kahdesti. Unohtunutta salasanaa ei voida palauttaa.';
    hint.textContent =
      'Välilyönnit ja Unicode-merkit ovat sallittuja. Salasanaa ei tallenneta Ekyyn.';
    confirmationGroup.hidden = false;
    confirmation.required = true;
    password.autocomplete = 'new-password';
  } else {
    title.textContent = 'Avaa salattu varmuuskopio';
    description.textContent =
      'Kirjoita varmuuskopiota luotaessa käyttämäsi salasana.';
    hint.textContent = 'Salasana käsitellään vain tämän tarkistuksen ajan.';
  }

  const setBusy = (busy: boolean) => {
    password.disabled = busy;
    confirmation.disabled = busy;
    cancel.disabled = busy;
    submit.disabled = busy;
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    error.textContent = '';
    setBusy(true);

    const message =
      mode === 'create'
        ? {
            confirmation: confirmation.value,
            operationId,
            password: password.value,
          }
        : {
            operationId,
            password: password.value,
          };

    void ipcRenderer
      .invoke(submitChannel, message)
      .then((result: unknown) => {
        if (
          typeof result === 'object' &&
          result !== null &&
          'accepted' in result &&
          result.accepted === true
        ) {
          return;
        }

        const errorCode =
          typeof result === 'object' &&
          result !== null &&
          'errorCode' in result
            ? result.errorCode
            : undefined;
        error.textContent =
          errorCode === 'PASSWORD_MISMATCH'
            ? 'Salasanat eivät täsmää.'
            : 'Salasanan pitää olla 16-256 merkkiä pitkä.';
        password.focus();
        setBusy(false);
      })
      .catch(() => {
        error.textContent =
          'Salasanaa ei voitu käsitellä turvallisesti.';
        setBusy(false);
      });
  });

  cancel.addEventListener('click', () => {
    setBusy(true);
    void ipcRenderer
      .invoke(cancelChannel, { operationId })
      .catch(() => undefined);
  });

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancel.click();
    }
  });
  window.addEventListener('unload', () => {
    password.value = '';
    confirmation.value = '';
  });

  password.focus();
});

function readArgument(prefix: string): string {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  return argument?.slice(prefix.length) ?? '';
}

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error('BACKUP_PASSWORD_WINDOW_PAGE_INVALID');
  }
  return element as T;
}

