import {
  parseProfileInspectionOriginalSources, parseProfileInspectionStatus,
  type ProfileInspectionDeployment, type ProfileInspectionOriginalSources, type ProfileInspectionRequestIdentity,
} from '../../runtime/profileInspectionMessages.js';
import {
  runColdOriginalProfileInspectionProcess, type OriginalProfileInspectionResult,
} from '../../runtime/profileInspectionProcess.js';
import type { ProfileInspectionDocumentBinding } from '../../runtime/profileInspectionDocumentBindings.js';
import { readProfileInspectionDocumentBindings } from '../../runtime/profileInspectionDocumentBindingsFile.js';
import { runOwnedProfileInspection, type OwnedProfileInspectionControl } from '../runOwnedProfileInspection.js';
import type { ProfileSnapshotInspectionReservation } from '../runProfileSnapshotInspection.js';

export interface ProfileRestoreOriginalInspectionResult {
  readonly status: OriginalProfileInspectionResult;
  /** Absent only when there was no original DB/catalog to attest. */
  readonly documents?: readonly ProfileInspectionDocumentBinding[];
}

/** Original content only; journal/census and fresh mutation authority belong to its caller. */
export async function runProfileRestoreOriginalInspection(input: {
  readonly operationId: string;
  readonly runnerPath: string;
  readonly deployment: ProfileInspectionDeployment;
  readonly reservation: ProfileSnapshotInspectionReservation;
  readonly assertAuthority: () => void;
  readonly assertLineage: (profileId: string) => void;
  readonly readSources: (input: { readonly deadline: number; readonly signal: AbortSignal }) => Promise<ProfileInspectionOriginalSources>;
  readonly signal: AbortSignal;
  readonly deadline?: number;
}): Promise<ProfileRestoreOriginalInspectionResult> {
  let identity: ProfileInspectionRequestIdentity | undefined;
  let documents: readonly ProfileInspectionDocumentBinding[] | undefined;
  const readSources = async (control: OwnedProfileInspectionControl) => {
    let settled = false;
    try {
      const sources = parseProfileInspectionOriginalSources(await control.read(() =>
        Promise.resolve().then(() => input.readSources({ deadline: control.deadline, signal: control.signal }))
          .finally(() => { settled = true; })));
      if (sources === undefined) throw invalid();
      return sources;
    } finally {
      // A still-running census cannot grant release or deletion of its source owner.
      if (!settled) input.reservation.invalidate();
    }
  };
  const readStatus = (returned: unknown): OriginalProfileInspectionResult => {
    const status = parseProfileInspectionStatus(returned);
    if (identity === undefined || status?.type !== 'originalCompleted' ||
        status.protocolVersion !== identity.protocolVersion || status.operationId !== identity.operationId ||
        status.generationId !== identity.generationId || status.runtimeSession !== identity.runtimeSession) throw invalid();
    return status;
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
    inspect(sources, options) {
      identity = options.identity;
      return runColdOriginalProfileInspectionProcess({ ...options, sources,
        runnerPath: input.runnerPath, deployment: input.deployment });
    },
    async afterExit(returned, inspectionRoot, control) {
      const status = readStatus(returned);
      await control.assertMainOwned();
      const receipt = status.result;
      if (receipt.databaseSlot === 'absent') return 'empty' as const;
      documents = await control.read(() => readProfileInspectionDocumentBindings(
        inspectionRoot, { ...receipt.documentBindings, ...receipt }, control.signal,
      ));
      await control.assertMainOwned();
    },
    async accept(initialSources, returned, control) {
      const status = readStatus(returned);
      const receipt = status.result;
      if (receipt.layout !== initialSources.layout || receipt.databaseSlot !== initialSources.databaseSlot ||
          receipt.documentsSlot !== initialSources.documentsSlot) throw invalid();
      await control.assertMainOwned();
      const currentSources = await readSources(control);
      if (initialSources.workspaceRoot !== currentSources.workspaceRoot || initialSources.layout !== currentSources.layout ||
          initialSources.databaseSlot !== currentSources.databaseSlot || initialSources.documentsSlot !== currentSources.documentsSlot) throw invalid();
      if (receipt.databaseSlot === 'absent') {
        if (documents !== undefined) throw invalid();
        await control.assertMainOwned();
        control.assertCurrent();
        return Object.freeze({ status });
      }
      if (documents === undefined) throw invalid();
      input.assertLineage(receipt.profileId);
      await control.assertMainOwned();
      input.assertLineage(receipt.profileId);
      control.assertCurrent();
      return Object.freeze({ status, documents });
    },
  });
}

function invalid(): Error { return new Error('PROFILE_INSPECTION_PROTOCOL_INVALID'); }
