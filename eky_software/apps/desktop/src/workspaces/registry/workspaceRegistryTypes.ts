declare const workspaceIdBrand: unique symbol;

export type WorkspaceId = string & {
  readonly [workspaceIdBrand]: 'WorkspaceId';
};

export interface WorkspaceLineageIdentityV1 {
  readonly formatVersion: 1;
  readonly profileId: string;
}

export type WorkspaceLifecycleState = 'ready' | 'recoveryRequired';

export interface LocalWorkspaceRegistryEntryV1 {
  readonly workspaceId: WorkspaceId;
  readonly workspaceLabel: string;
  readonly lineageIdentity: Readonly<WorkspaceLineageIdentityV1>;
  readonly layoutVersion: 1;
  readonly lifecycleState: WorkspaceLifecycleState;
  readonly createdAt: string;
}

export interface LocalWorkspaceRegistryV1 {
  readonly formatVersion: 1;
  readonly activeWorkspaceId: WorkspaceId | null;
  readonly workspaces: readonly Readonly<LocalWorkspaceRegistryEntryV1>[];
}
