import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript';
import type { ProfileMaintenanceService } from './profileSnapshotBrokerBackend.js';

interface MaintenanceState extends ProfileMaintenanceService {
  tryBeginBusinessWrite(): (() => void) | undefined;
  isActiveOperation(operationId: string): boolean;
}

// Load the actual backend owner without expanding the desktop compilation root.
const source = await readFile(new URL('../../../backend/src/runtime/profileMaintenance/profileMaintenanceState.ts', import.meta.url), 'utf8');
const { outputText } = transpileModule(source, { compilerOptions: {
  module: ModuleKind.CommonJS, target: ScriptTarget.ES2022,
}, fileName: 'profileMaintenanceState.ts' });
const backendExports = {} as {
  ProfileMaintenanceState: new () => MaintenanceState;
  ProfileMaintenanceOperationMismatchError: ErrorConstructor;
};
new Script(outputText).runInNewContext({ exports: backendExports, performance,
  setTimeout: (...args: Parameters<typeof setTimeout>) => setTimeout(...args),
  clearTimeout: (...args: Parameters<typeof clearTimeout>) => clearTimeout(...args),
});
export const { ProfileMaintenanceState, ProfileMaintenanceOperationMismatchError } = backendExports;
