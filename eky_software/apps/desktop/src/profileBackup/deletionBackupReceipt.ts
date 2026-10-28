import {
  parseProfileInspectionStatus,
  type ProfileInspectionReceipt,
  type ProfileInspectionRequestIdentity,
} from '../runtime/profileInspectionMessages.js';
import { assertUpdateJournalAuthority } from '../update/updateJournalStore.js';
import { assertDeletionBackupCorrespondence } from './assertDeletionBackupCorrespondence.js';
import type { AuthenticatedBackupFileIdentity } from './container/decryptBackupPayload.js';
import type { DeletionBackupContent } from './portableProfileBackup.js';

export type InspectionBinding = Pick<ProfileInspectionRequestIdentity,
  'operationId' | 'generationId' | 'runtimeSession'>;

export interface DeletionBackupBinding {
  readonly operationId: string;
  readonly workspaceId: string;
  readonly registryEntrySha256: string;
  readonly profileId: string;
  readonly rootIdentity: string;
  readonly leaseOwner: string;
  readonly runtimeGeneration: string;
}

export interface ExportIdentity {
  readonly fileIdentity: string;
  readonly byteSize: number;
  readonly sha256: string;
}

export function createDeletionBackupExportIdentity(
  file: AuthenticatedBackupFileIdentity,
  sha256: string,
): Readonly<ExportIdentity> {
  return Object.freeze({
    fileIdentity: [file.dev, file.ino, file.size, file.mtimeNs, file.ctimeNs].join(':'),
    byteSize: Number(file.size),
    sha256,
  });
}

export interface InspectedDeletionBackupBinding extends DeletionBackupBinding {
  readonly source: Readonly<InspectionBinding>;
  readonly exported: Readonly<InspectionBinding>;
}

interface Ports {
  // Owners keep a monotonic invalidation latch, even if a lease is reacquired.
  assertSnapshotBoundary(binding: DeletionBackupBinding): void;
  assertContinuity(binding: DeletionBackupBinding | InspectedDeletionBackupBinding): void;
  assertOwnersExited(binding: InspectedDeletionBackupBinding): void;
  assertInspectionCleanup(binding: InspectedDeletionBackupBinding): void;
  assertCurrent(binding: DeletionBackupBinding | InspectedDeletionBackupBinding): Promise<void>;
  recheckAuthenticatedExport(): Promise<ExportIdentity>;
}

export function beginDeletionBackupProof(input: DeletionBackupBinding, ports: Ports) {
  const binding = Object.freeze({ ...input });
  let currentBinding: DeletionBackupBinding | InspectedDeletionBackupBinding = binding;
  let phase: 'snapshot' | 'issuing' | 'issued' | 'consuming' | 'spent' | 'invalid' = 'snapshot';
  const checked = (assertion: () => void) => {
    try {
      assertUpdateJournalAuthority(assertion);
      if (phase === 'invalid' || phase === 'spent') fail();
    } catch (error) {
      phase = 'invalid';
      throw error;
    }
  };
  const assertContinuous = () => {
    if (phase === 'invalid' || phase === 'spent') fail();
    checked(() => ports.assertContinuity(currentBinding));
  };
  const assertCurrent = async () => {
    assertContinuous();
    await ports.assertCurrent(currentBinding);
    assertContinuous();
  };
  // Start continuity before the snapshot, not retroactively when issuing it.
  checked(() => ports.assertSnapshotBoundary(binding));
  assertContinuous();
  return Object.freeze({
    invalidate() { phase = 'invalid'; },
    async issue(content: DeletionBackupContent) {
      if (phase !== 'snapshot') fail();
      phase = 'issuing';
      try {
        await assertCurrent();
        assertContinuous();
        const source = completed({
          ...content.sourceIdentity, type: 'completed', result: content.sourceReceipt,
        }, 'exactCurrentManifest');
        const exported = completed({
          ...content.exported.identity, type: 'completed', result: content.exported.receipt,
        }, 'restoreCompatible');
        if (source.operationId !== binding.operationId || source.operationId === exported.operationId ||
            source.generationId === exported.generationId || source.runtimeSession === exported.runtimeSession) fail();
        const authenticatedIdentity = createDeletionBackupExportIdentity(
          content.exported.authenticatedFileIdentity, content.exported.containerSha256,
        );
        if (source.result.profileId !== binding.profileId || !/^[a-f0-9]{64}$/u.test(authenticatedIdentity.sha256) ||
            authenticatedIdentity.fileIdentity.length === 0 || !Number.isSafeInteger(authenticatedIdentity.byteSize) ||
            authenticatedIdentity.byteSize <= 0) fail();
        try {
          assertDeletionBackupCorrespondence(source.result, exported.result);
        } catch (cause) {
          fail(cause);
        }
        const issuedBinding: InspectedDeletionBackupBinding = Object.freeze({
          ...binding, source: captureIdentity(source), exported: captureIdentity(exported),
        });
        currentBinding = issuedBinding;
        checked(() => ports.assertInspectionCleanup(issuedBinding));
        const identity = Object.freeze({ ...authenticatedIdentity });
        await assertCurrent();
        assertContinuous();
        phase = 'issued';
        return Object.freeze({
          scope: 'portableBusinessSnapshot' as const,
          async consume(publishAuthorized: (
            assertAuthority: () => void, assertPublicationCurrent: () => Promise<void>,
          ) => Promise<void>) {
            if (phase !== 'issued') fail();
            phase = 'consuming';
            let firstRecheckFailure: { error: unknown } | undefined;
            const guard = () => {
              if (phase !== 'consuming') fail();
              assertContinuous();
              checked(() => ports.assertOwnersExited(issuedBinding));
              checked(() => ports.assertInspectionCleanup(issuedBinding));
            };
            const assertSelection = async () => {
              guard();
              await assertCurrent();
              guard();
            };
            // Publication may await after admission. Its async guard must read
            // the export again, not reuse the admission check or just its path.
            const assertPublicationCurrent = async () => {
              try {
                await assertSelection();
                guard();
                const current = await ports.recheckAuthenticatedExport();
                guard();
                if (!sameIdentity(identity, current)) fail();
                await assertSelection();
                guard();
              } catch (error) {
                phase = 'invalid';
                firstRecheckFailure ??= { error };
                throw firstRecheckFailure.error;
              }
            };
            try {
              await assertPublicationCurrent();
              guard();
              await publishAuthorized(guard, assertPublicationCurrent);
              await assertPublicationCurrent();
              guard();
              phase = 'spent';
            } catch (error) {
              phase = 'invalid';
              throw firstRecheckFailure === undefined ? error : firstRecheckFailure.error;
            }
          },
        });
      } catch (error) {
        phase = 'invalid';
        throw error;
      }
    },
  });
}

function completed(value: unknown, policy: ProfileInspectionReceipt['migrationPolicy']) {
  const result = parseProfileInspectionStatus(value);
  if (result?.type !== 'completed' || result.result.migrationPolicy !== policy) fail();
  return result;
}

function captureIdentity(value: InspectionBinding): Readonly<InspectionBinding> {
  return Object.freeze({
    operationId: value.operationId, generationId: value.generationId, runtimeSession: value.runtimeSession,
  });
}

function sameIdentity(left: ExportIdentity, right: ExportIdentity): boolean {
  return left.fileIdentity === right.fileIdentity && left.byteSize === right.byteSize && left.sha256 === right.sha256;
}

function fail(cause?: unknown): never {
  throw new Error('WORKSPACE_DELETE_BACKUP_UNAVAILABLE', cause === undefined ? undefined : { cause });
}
