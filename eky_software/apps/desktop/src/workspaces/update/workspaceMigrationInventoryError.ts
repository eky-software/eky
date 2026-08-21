export const workspaceMigrationInventoryFailedCode =
  'WORKSPACE_MIGRATION_INVENTORY_FAILED';
export const workspaceMigrationInventoryCancelledCode =
  'WORKSPACE_MIGRATION_INVENTORY_CANCELLED';

export class WorkspaceMigrationInventoryError extends Error {
  constructor(
    readonly code:
      | typeof workspaceMigrationInventoryCancelledCode
      | typeof workspaceMigrationInventoryFailedCode,
  ) {
    super(code);
    this.name = 'WorkspaceMigrationInventoryError';
  }
}
