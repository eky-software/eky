const { ipcRenderer } = require('electron') as typeof import('electron');

const createSupportBundleChannel =
  'eky:update-recovery:create-support-bundle';
const openLogsChannel = 'eky:update-recovery:open-logs';
const selectRollbackChannel =
  'eky:update-recovery:select-rollback-package';
const closeChannel = 'eky:update-recovery:close';

const errorCode = readSafeArgument(
  '--eky-update-recovery-error=',
  /^[A-Z][A-Z0-9_]{2,80}$/,
);
const appVersion = readSafeArgument(
  '--eky-update-recovery-version=',
  /^[0-9A-Za-z.+-]{1,80}$/,
);
const buildRevision = readSafeArgument(
  '--eky-update-recovery-build=',
  /^[0-9a-f]{7,40}$/i,
);
const rollbackAllowed =
  readSafeArgument('--eky-update-recovery-rollback=', /^(?:yes|no)$/) ===
  'yes';

window.addEventListener('DOMContentLoaded', () => {
  requireElement('error-code').textContent = errorCode;
  requireElement('app-version').textContent = appVersion;
  requireElement('build-revision').textContent = buildRevision;

  const supportBundle = requireButton('support-bundle');
  const openLogs = requireButton('open-logs');
  const selectRollback = requireButton('select-rollback');
  const close = requireButton('close');
  const status = requireElement('status');
  selectRollback.hidden = !rollbackAllowed;

  const buttons = [supportBundle, openLogs, selectRollback, close];
  const invoke = (channel: string, successMessage: string) => {
    buttons.forEach((button) => {
      button.disabled = true;
    });
    status.textContent = '';
    void ipcRenderer
      .invoke(channel)
      .then((result: unknown) => {
        status.textContent =
          isCompleted(result)
            ? successMessage
            : 'Toimintoa ei voitu tehdä turvallisesti.';
      })
      .catch(() => {
        status.textContent = 'Toimintoa ei voitu tehdä turvallisesti.';
      })
      .finally(() => {
        buttons.forEach((button) => {
          button.disabled = false;
        });
      });
  };

  supportBundle.addEventListener('click', () => {
    invoke(
      createSupportBundleChannel,
      'Tekninen palautustukipaketti luotiin. Paketti ei ole salattu.',
    );
  });
  openLogs.addEventListener('click', () => {
    invoke(openLogsChannel, 'Lokikansio avattiin.');
  });
  selectRollback.addEventListener('click', () => {
    invoke(
      selectRollbackChannel,
      'Palautuspaketti hyväksyttiin. Eky käynnistää palautuksen.',
    );
  });
  close.addEventListener('click', () => {
    invoke(closeChannel, 'Eky suljetaan.');
  });
});

function readSafeArgument(prefix: string, pattern: RegExp): string {
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const value = argument?.slice(prefix.length) ?? '';
  if (!pattern.test(value)) {
    throw new Error('UPDATE_RECOVERY_WINDOW_CONFIGURATION_INVALID');
  }
  return value;
}

function requireElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) {
    throw new Error('UPDATE_RECOVERY_WINDOW_PAGE_INVALID');
  }
  return element;
}

function requireButton(id: string): HTMLButtonElement {
  return requireElement(id) as HTMLButtonElement;
}

function isCompleted(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'status' in value &&
    value.status === 'completed'
  );
}
