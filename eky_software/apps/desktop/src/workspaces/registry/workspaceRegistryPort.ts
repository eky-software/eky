import type { LocalWorkspaceRegistry } from './workspaceRegistryTypes.js';

export interface WorkspaceRegistryPort {
  read(): Promise<Readonly<LocalWorkspaceRegistry> | undefined>;
  write(value: unknown): Promise<void>;
}

export interface WorkspaceRegistryInspectionPort {
  inspect(): Promise<Readonly<LocalWorkspaceRegistry> | undefined>;
}
