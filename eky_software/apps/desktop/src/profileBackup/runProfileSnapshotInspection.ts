import {
  isProfileInspectionOperationId, isProfileInspectionMigrationPolicy, parseProfileInspectionActiveContext, parseProfileInspectionReceipt,
  type ProfileInspectionActiveContext, type ProfileInspectionDeployment, type ProfileInspectionMigrationPolicy, type ProfileInspectionReceipt,
  type ProfileInspectionRequestIdentity,
} from '../runtime/profileInspectionMessages.js';
import { runProfileInspectionProcess } from '../runtime/profileInspectionProcess.js';
import type { WorkspaceProcessReservationTransfer } from '../runtime/workspaceProcessReservation.js';
import { runOwnedProfileInspection, type OwnedProfileInspectionControl } from './runOwnedProfileInspection.js';

export interface ProfileSnapshotInspectionReservation {
  assertMainOwned(): Promise<void>;
  bind(generationId: string, assertAuthority: () => void,
    prepareMainOwned: (signal: AbortSignal) => Promise<void>): WorkspaceProcessReservationTransfer;
  invalidate(): void;
}

export interface ProfileSnapshotInspectionValidation {
  readonly type: 'profileSnapshotValidation';
  readonly activeProfileIsEmpty: boolean;
  readonly artifactCount: number;
  readonly artifactTotalByteSize: number;
  readonly databaseHealth: 'healthy';
  readonly migrationChainIdentity: string;
  readonly profileId: string;
  readonly profileMatchesActive: boolean;
}

export interface ReadProfileInspectionContextInput {
  readonly operationId: string;
  readonly kind: 'inspect' | 'prepareRestoreActivation';
  readonly updateMaintenanceOperationId?: string;
  readonly deleteMaintenanceOperationId?: string;
  readonly deadline: number;
  readonly signal: AbortSignal;
}

/** The main-owned operation reservation remains held for the caller's use/cleanup. */
export async function runProfileSnapshotInspection(input: {
  readonly operationId: string;
  readonly kind: ReadProfileInspectionContextInput['kind'];
  readonly migrationPolicy: ProfileInspectionMigrationPolicy;
  readonly updateMaintenanceOperationId?: string;
  readonly deleteMaintenanceOperationId?: string;
  readonly runnerPath: string;
  readonly deployment: ProfileInspectionDeployment;
  readonly reservation: ProfileSnapshotInspectionReservation;
  readonly readActiveContext: (input: ReadProfileInspectionContextInput) => Promise<ProfileInspectionActiveContext>;
  readonly assertAuthority: () => void;
  readonly signal: AbortSignal;
  /** A caller may include root acquisition in the same work budget, never extend it. */
  readonly deadline?: number;
}): Promise<Readonly<{ validation: ProfileSnapshotInspectionValidation; receipt: ProfileInspectionReceipt;
  identity: ProfileInspectionRequestIdentity }>> {
  const readContext = async (control: OwnedProfileInspectionControl) => {
    const context = parseProfileInspectionActiveContext(await control.read(() => input.readActiveContext({
      operationId: input.operationId, kind: input.kind, deadline: control.deadline, signal: control.signal,
      ...(input.updateMaintenanceOperationId === undefined ? {} : {
        updateMaintenanceOperationId: input.updateMaintenanceOperationId,
      }),
      ...(input.deleteMaintenanceOperationId === undefined ? {} : {
        deleteMaintenanceOperationId: input.deleteMaintenanceOperationId,
      }),
    })));
    if (context === undefined) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    return context;
  };
  return runOwnedProfileInspection({
    ...input,
    async prepare(control) {
      if (!isProfileInspectionMigrationPolicy(input.migrationPolicy) ||
          (input.updateMaintenanceOperationId !== undefined && !isProfileInspectionOperationId(input.updateMaintenanceOperationId)) ||
          (input.deleteMaintenanceOperationId !== undefined && (
            !isProfileInspectionOperationId(input.deleteMaintenanceOperationId) ||
            input.updateMaintenanceOperationId !== undefined || input.kind !== 'inspect'))) {
        throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      }
      await control.assertMainOwned();
      const context = await readContext(control);
      await control.assertMainOwned();
      return context;
    },
    inspect: async (_context, options) => ({
      receipt: await runProfileInspectionProcess({ ...options,
        kind: input.kind, migrationPolicy: input.migrationPolicy, runnerPath: input.runnerPath, deployment: input.deployment,
      }),
      identity: options.identity,
    }),
    async accept(initialContext, returned, control) {
      const receipt = parseProfileInspectionReceipt(returned.receipt);
      if (receipt === undefined || receipt.migrationPolicy !== input.migrationPolicy) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      await control.assertMainOwned();
      const finalContext = await readContext(control);
      if (initialContext.activeProfileId !== finalContext.activeProfileId) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      await control.assertMainOwned();
      const validation = Object.freeze({
        type: 'profileSnapshotValidation' as const, activeProfileIsEmpty: finalContext.activeProfileIsEmpty,
        artifactCount: receipt.artifactCount, artifactTotalByteSize: receipt.artifactTotalByteSize,
        databaseHealth: receipt.databaseHealth, migrationChainIdentity: receipt.migrationChainIdentity,
        profileId: receipt.profileId, profileMatchesActive: receipt.profileId === finalContext.activeProfileId,
      });
      return Object.freeze({ validation, receipt, identity: returned.identity });
    },
  });
}
