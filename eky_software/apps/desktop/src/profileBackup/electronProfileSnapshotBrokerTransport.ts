import type { MessagePortMain } from 'electron';

import type { ProfileSnapshotBrokerTransport } from './profileSnapshotBrokerTransport.js';

export function createProfileSnapshotBrokerTransport(
  port: MessagePortMain,
): ProfileSnapshotBrokerTransport {
  port.start();

  return {
    close: () => port.close(),
    send: (value) => port.postMessage(value),
    subscribe(listener) {
      const eventListener = (event: { data: unknown }) => listener(event.data);
      port.on('message', eventListener);
      return () => port.off('message', eventListener);
    },
    subscribeClose(listener) {
      port.on('close', listener);
      return () => port.off('close', listener);
    },
  };
}
