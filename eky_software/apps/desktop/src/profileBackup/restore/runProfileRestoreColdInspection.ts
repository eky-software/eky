import {
  parseColdProfileInspectionReceipt, parseProfileInspectionColdSources,
  type ColdProfileInspectionReceipt, type ProfileInspectionColdSources, type ProfileInspectionDeployment,
} from '../../runtime/profileInspectionMessages.js';
import { runColdProfileInspectionProcess } from '../../runtime/profileInspectionProcess.js';
import type { ProfileInspectionDocumentBinding } from '../../runtime/profileInspectionDocumentBindings.js';
import { readProfileInspectionDocumentBindings } from '../../runtime/profileInspectionDocumentBindingsFile.js';
import { runOwnedProfileInspection, type OwnedProfileInspectionControl } from '../runOwnedProfileInspection.js';
import type { ProfileSnapshotInspectionReservation } from '../runProfileSnapshotInspection.js';

export interface ProfileRestoreColdInspectionResult {
  readonly receipt: ColdProfileInspectionReceipt;
  readonly documents: readonly ProfileInspectionDocumentBinding[];
}

/** A content receipt, not forward/rollback permission; the caller owns fresh journal and byte admission. */
export async function runProfileRestoreColdInspection(input: {
  readonly operationId: string;
  readonly runnerPath: string;
  readonly deployment: ProfileInspectionDeployment;
  readonly reservation: ProfileSnapshotInspectionReservation;
  readonly assertAuthority: () => void;
  readonly assertLineage: (profileId: string) => void;
  readonly readSources: (input: { readonly deadline: number; readonly signal: AbortSignal }) => Promise<ProfileInspectionColdSources>;
  readonly signal: AbortSignal;
  readonly deadline?: number;
}): Promise<ProfileRestoreColdInspectionResult> {
  let documents: readonly ProfileInspectionDocumentBinding[] | undefined;
  const readSources = async (control: OwnedProfileInspectionControl) => {
    const sources = parseProfileInspectionColdSources(await control.read(() => input.readSources({
      deadline: control.deadline, signal: control.signal,
    })));
    if (sources === undefined) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    return sources;
  };
  return runOwnedProfileInspection({
    ...input,
    copyKind: 'coldRestoreContent',
    async prepare(control) {
      await control.assertMainOwned();
      const sources = await readSources(control);
      await control.assertMainOwned();
      return sources;
    },
    inspect: (sources, options) => runColdProfileInspectionProcess({ ...options, sources,
      runnerPath: input.runnerPath, deployment: input.deployment,
    }),
    async afterExit(returned, inspectionRoot, control) {
      const receipt = parseColdProfileInspectionReceipt(returned);
      if (receipt === undefined) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      await control.assertMainOwned();
      documents = await control.read(() => readProfileInspectionDocumentBindings(
        inspectionRoot, { ...receipt.documentBindings, ...receipt }, control.signal,
      ));
      await control.assertMainOwned();
    },
    async accept(initialSources, returned, control) {
      const receipt = parseColdProfileInspectionReceipt(returned);
      if (receipt === undefined || documents === undefined || receipt.databaseSlot !== initialSources.databaseSlot ||
          receipt.documentsSlot !== initialSources.documentsSlot) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      await control.assertMainOwned();
      const currentSources = await readSources(control);
      if (initialSources.workspaceRoot !== currentSources.workspaceRoot ||
          initialSources.databaseSlot !== currentSources.databaseSlot ||
          initialSources.documentsSlot !== currentSources.documentsSlot) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
      input.assertLineage(receipt.profileId);
      await control.assertMainOwned();
      input.assertLineage(receipt.profileId);
      control.assertCurrent();
      return Object.freeze({ receipt, documents });
    },
  });
}
