import { describe, expect, it, vi } from 'vitest';
import type { MessageBoxOptions } from 'electron';

vi.mock('electron', () => ({ dialog: {} }));

import { createInvoiceDeliveryConfirmation } from './invoiceDeliveryConfirmation.js';

describe('invoice delivery native dialog', () => {
  it.each([
    ['revision', false, 'Lähetä lasku', 'Vahvista laskun lähetys'],
    ['revision', true, 'Lähetä uudelleen', 'Vahvista laskun uudelleenlähetys'],
    ['preservedLegacy', true, 'Lähetä säilytetty PDF', 'Vahvista säilytetyn PDF:n uudelleenlähetys'],
  ] as const)('shows the explicit %s confirmation (resend=%s)', async (kind, resend, button, message) => {
    const showMessageBox = vi.fn(async (_owner: unknown, _options: MessageBoxOptions) => ({ response: 1, checkboxChecked: false }));
    const dialogs = createInvoiceDeliveryConfirmation(() => undefined, {
      showMessageBox, showErrorBox: vi.fn(),
    });
    const preparation = {
      documentTarget: { kind, documentId: 'document-1' },
      attachmentFileName: 'preserved.pdf', attachmentSizeBytes: 2048,
      invoiceId: 'invoice-1', invoiceNumber: '20260001', resend,
      body: 'Synthetic body', cc: 'copy@example.test', subject: 'Invoice',
      sender: 'sender@example.test', recipient: 'recipient@example.test',
    };
    expect(await dialogs.confirmInvoiceEmailPreparation(preparation)).toBe(false);
    const options = showMessageBox.mock.calls[0]![1];
    expect(options).toMatchObject({ buttons: [button, 'Peruuta'], message, cancelId: 1, defaultId: 1, noLink: true });
    for (const field of ['preserved.pdf', 'recipient@example.test', 'copy@example.test', 'sender@example.test', 'Invoice', 'Synthetic body']) {
      expect(options.detail).toContain(field);
    }
    if (kind === 'preservedLegacy') {
      expect(options.detail).toContain('Sitä ei ole muodostettu uudelleen.');
      expect(options.detail).toContain('Vanhan lähetyksen sisältöä ei voida jälkikäteen varmasti todistaa.');
    } else {
      expect(options.detail).not.toContain('Vanhan lähetyksen');
    }
    showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false });
    expect(await dialogs.confirmInvoiceEmailPreparation(preparation)).toBe(true);
    expect(showMessageBox).toHaveBeenCalledTimes(2);
  });
});
