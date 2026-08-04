import type { ProfileMaintenanceState } from './profileMaintenanceState.js';

export function beginProfileMaintenance(
  state: ProfileMaintenanceState,
  input: {
    operationId: string;
    timeoutMilliseconds: number;
  },
): Promise<void> {
  return state.begin(input.operationId, input.timeoutMilliseconds);
}
