import type { LocalWorkspaceRegistryV1 } from './workspaceRegistryTypes.js';

export interface WorkspaceRegistryPort {
  read(): Promise<Readonly<LocalWorkspaceRegistryV1> | undefined>;
  write(value: unknown): Promise<void>;
}
