import type { ProfileMaintenanceState } from './profileMaintenanceState.js';

export function endProfileMaintenance(
  state: ProfileMaintenanceState,
  operationId: string,
): void {
  state.end(operationId);
}
