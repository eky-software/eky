export interface WorkspaceRuntimeAbsencePort {
  assertNoActiveWorkspaceRuntime(): Promise<void>;
}
