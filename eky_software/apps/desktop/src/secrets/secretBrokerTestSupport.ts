import type { SecretBrokerTerminal, SecretBrokerTransport } from './secretBrokerTransport.js';

export class ControlledSecretTransport implements SecretBrokerTransport {
  readonly messages: unknown[] = [];
  readonly listeners = new Set<(value: unknown) => void>();
  readonly terminalListeners = new Set<(reason: SecretBrokerTerminal) => void>();
  peer: ControlledSecretTransport | undefined;
  terminal: SecretBrokerTerminal | undefined;
  beforeSend: ((value: unknown) => boolean) | undefined;
  failClose = false;
  failUnsubscribe = false;
  closeCount = 0;
  unsubscribeCount = 0;

  send(value: unknown): void {
    if (this.terminal !== undefined) throw new Error('Synthetic transport closed.');
    this.messages.push(value);
    if (this.beforeSend?.(value) === false) return;
    this.peer?.receive(structuredClone(value));
  }

  receive(value: unknown): void {
    for (const listener of [...this.listeners]) listener(value);
  }

  terminate(reason: SecretBrokerTerminal): void {
    if (this.terminal !== undefined) return;
    this.terminal = reason;
    for (const listener of [...this.terminalListeners]) listener(reason);
  }

  close(): void {
    this.closeCount++;
    this.terminate('closed');
    this.peer?.terminate('closed');
    if (this.failClose) throw new Error('Synthetic close failure.');
  }

  subscribe(listener: (value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.unsubscribeCount++;
      this.listeners.delete(listener);
      if (this.failUnsubscribe) throw new Error('Synthetic unsubscribe failure.');
    };
  }

  subscribeTerminal(listener: (reason: SecretBrokerTerminal) => void): () => void {
    this.terminalListeners.add(listener);
    if (this.terminal !== undefined) listener(this.terminal);
    return () => {
      this.unsubscribeCount++;
      this.terminalListeners.delete(listener);
      if (this.failUnsubscribe) throw new Error('Synthetic terminal unsubscribe failure.');
    };
  }
}

export function createLinkedSecretTransports(): [ControlledSecretTransport, ControlledSecretTransport] {
  const client = new ControlledSecretTransport();
  const main = new ControlledSecretTransport();
  client.peer = main;
  main.peer = client;
  return [client, main];
}

export function createSecretGate(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(yes => { resolve = yes; });
  return { promise, resolve };
}
