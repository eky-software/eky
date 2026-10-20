export type SecretBrokerTerminal = 'closed' | 'error';

export interface SecretBrokerTransport {
  close(): void;
  send(value: unknown): void;
  subscribe(listener: (value: unknown) => void): () => void;
  subscribeTerminal(listener: (reason: SecretBrokerTerminal) => void): () => void;
}
