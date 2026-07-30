import {
  dialog,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from 'electron';

import {
  createInvoiceEmailConfirmationDetail,
  type InvoiceEmailPreparationConfirmation,
} from './invoiceEmailConfirmation.js';
import type { SmtpTestPreparationConfirmation } from './smtpTestConfirmation.js';
import { restoreWindowInputFocus } from './windowInputFocus.js';

export interface InvoiceDeliveryConfirmation {
  confirmInvoiceEmailPreparation(
    preparation: InvoiceEmailPreparationConfirmation,
  ): Promise<boolean>;
  confirmSmtpTestPreparation(
    preparation: SmtpTestPreparationConfirmation,
  ): Promise<boolean>;
  showApplicationError(title: string, message: string): void;
}

export interface InvoiceDeliveryDialogAdapter {
  showErrorBox(title: string, message: string): void;
  showMessageBox(
    owner: BrowserWindow | undefined,
    options: MessageBoxOptions,
  ): Promise<MessageBoxReturnValue>;
}

const electronInvoiceDeliveryDialogAdapter: InvoiceDeliveryDialogAdapter = {
  showErrorBox(title, message) {
    dialog.showErrorBox(title, message);
  },
  showMessageBox(owner, options) {
    return owner === undefined || owner.isDestroyed()
      ? dialog.showMessageBox(options)
      : dialog.showMessageBox(owner, options);
  },
};

export function createInvoiceDeliveryConfirmation(
  getApplicationWindow: () => BrowserWindow | undefined,
  dialogAdapter: InvoiceDeliveryDialogAdapter =
    electronInvoiceDeliveryDialogAdapter,
): InvoiceDeliveryConfirmation {
  async function showApplicationMessageBox(
    options: MessageBoxOptions,
  ): Promise<number> {
    const owner = getApplicationWindow();

    try {
      const result = await dialogAdapter.showMessageBox(owner, options);

      return result.response;
    } finally {
      restoreWindowInputFocus(owner);
    }
  }

  return {
    async confirmInvoiceEmailPreparation(preparation) {
      const response = await showApplicationMessageBox({
        buttons: [
          preparation.resend ? 'Lähetä uudelleen' : 'Lähetä lasku',
          'Peruuta',
        ],
        cancelId: 1,
        defaultId: 1,
        detail: createInvoiceEmailConfirmationDetail(preparation),
        message: preparation.resend
          ? 'Vahvista laskun uudelleenlähetys'
          : 'Vahvista laskun lähetys',
        noLink: true,
        title: 'Eky - laskun sähköposti',
        type: 'question',
      });

      return response === 0;
    },
    async confirmSmtpTestPreparation(preparation) {
      const response = await showApplicationMessageBox({
        buttons: ['Lähetä testiviesti', 'Peruuta'],
        cancelId: 1,
        defaultId: 1,
        detail: [
          `Vastaanottaja: ${preparation.testRecipient}`,
          `Otsikko: ${preparation.subject}`,
          `Liite: ${preparation.attachmentFileName}`,
        ].join('\n'),
        message: 'Vahvista DNA SMTP -testilähetys',
        noLink: true,
        title: 'Eky - sähköpostitesti',
        type: 'question',
      });

      return response === 0;
    },
    showApplicationError(title, message) {
      const owner = getApplicationWindow();

      if (owner === undefined || owner.isDestroyed()) {
        dialogAdapter.showErrorBox(title, message);
        return;
      }

      void dialogAdapter
        .showMessageBox(owner, {
          buttons: ['Sulje'],
          cancelId: 0,
          defaultId: 0,
          message,
          noLink: true,
          title,
          type: 'error',
        })
        .catch(() => undefined)
        .finally(() => restoreWindowInputFocus(owner));
    },
  };
}
