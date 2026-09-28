export interface E2eBackendWorkload {
  readonly instanceId: string;
  readState(): Promise<'running' | 'exited' | 'unavailable'>;
  readRssBytes(): Promise<number>;
}
