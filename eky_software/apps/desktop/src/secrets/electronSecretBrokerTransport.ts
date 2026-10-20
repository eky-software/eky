import type { MessagePortMain } from 'electron';

import { SecretBrokerError } from './secretBrokerErrors.js';
import type { SecretBrokerTerminal, SecretBrokerTransport } from './secretBrokerTransport.js';

export function createMainSecretBrokerTransport(
  port: MessagePortMain,
): SecretBrokerTransport {
  return createSecretBrokerTransport(port);
}

export function createUtilitySecretBrokerTransport(
  port: MessagePortMain,
): SecretBrokerTransport {
  return createSecretBrokerTransport(port);
}

function createSecretBrokerTransport(port: MessagePortMain): SecretBrokerTransport {
  const terminalListeners = new Set<(reason: SecretBrokerTerminal) => void>();
  const messageListeners = new Set<(event: { data: unknown }) => void>();
  let terminal: SecretBrokerTerminal | undefined;
  let closeAttempted = false;
  let closeFailure: SecretBrokerError | undefined;
  const terminate = (reason: SecretBrokerTerminal) => {
    if (terminal !== undefined) return;
    terminal = reason;
    for (const listener of [...terminalListeners]) {
      try { listener(reason); }
      catch { /* A terminal observer cannot prevent notification of other owners. */ }
    }
  };
  const onClose = () => terminate('closed');
  const close = () => {
    if (!closeAttempted) {
      closeAttempted = true;
      const teardown = [
        ...[...messageListeners].map(listener => () => port.off('message', listener)),
        () => port.close(),
        () => port.off('close', onClose),
      ];
      for (const dispose of teardown) {
        try { dispose(); }
        catch { closeFailure ??= new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED'); }
      }
      messageListeners.clear();
      terminate(closeFailure === undefined ? 'closed' : 'error');
      terminalListeners.clear();
    }
    if (closeFailure !== undefined) throw closeFailure;
  };
  try {
    port.on('close', onClose);
    port.start();
  } catch {
    closeFailure = new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED');
    close();
    throw closeFailure;
  }

  return {
    close,
    send(value) {
      if (terminal !== undefined) throw new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED');
      try { port.postMessage(value); }
      catch {
        terminate('error');
        throw new SecretBrokerError('SECRET_BROKER_TRANSPORT_FAILED');
      }
    },
    subscribe(listener) {
      if (terminal !== undefined) return () => {};
      const eventListener = (event: { data: unknown }) => listener(event.data);

      port.on('message', eventListener);
      messageListeners.add(eventListener);

      return () => {
        port.off('message', eventListener);
        messageListeners.delete(eventListener);
      };
    },
    subscribeTerminal(listener) {
      if (terminal !== undefined) listener(terminal);
      else terminalListeners.add(listener);
      return () => { terminalListeners.delete(listener); };
    },
  };
}
