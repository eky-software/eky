export interface WorkspaceOperationGate {
  current: boolean;
}

export function tryAcquireWorkspaceOperation(
  gate: WorkspaceOperationGate,
): boolean {
  if (gate.current) return false;
  gate.current = true;
  return true;
}
