import type { MessagePortMain } from 'electron';

import type { SecretBrokerTransport } from './secretBrokerTransport.js';

export function createMainSecretBrokerTransport(
  port: MessagePortMain,
): SecretBrokerTransport {
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

export function createUtilitySecretBrokerTransport(
  port: MessagePortMain,
): SecretBrokerTransport {
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
