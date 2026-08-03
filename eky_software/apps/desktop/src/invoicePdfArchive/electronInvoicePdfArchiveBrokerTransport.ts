import type { MessagePortMain } from 'electron';

import type { InvoicePdfArchiveBrokerTransport } from './invoicePdfArchiveBrokerTransport.js';

export function createInvoicePdfArchiveBrokerTransport(
  port: MessagePortMain,
): InvoicePdfArchiveBrokerTransport {
  port.start();

  return {
    close: () => port.close(),
    send: (value) => port.postMessage(value),
    subscribe(listener) {
      const eventListener = (event: { data: unknown }) => listener(event.data);

      port.on('message', eventListener);
      return () => port.off('message', eventListener);
    },
  };
}
