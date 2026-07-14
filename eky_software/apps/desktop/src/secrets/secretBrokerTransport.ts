export interface SecretBrokerTransport {
  close(): void;
  send(value: unknown): void;
  subscribe(listener: (value: unknown) => void): () => void;
}
