import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import { SqliteInvoiceBackupArtifactCatalog } from '../../modules/invoicing/infrastructure/sqliteInvoiceBackupArtifactCatalog.js';
import { selectInvoiceBackupArtifactCatalogSchema } from '../../modules/invoicing/infrastructure/selectInvoiceBackupArtifactCatalogSchema.js';
import {
  invoiceBackupArtifactMaximumCount,
  invoiceBackupArtifactMaximumTextBytes,
  type InvoiceBackupArtifactCatalogItem,
} from '../../modules/invoicing/ports/invoiceBackupArtifactCatalog.js';
import { copyAttestedWorkspaceDatabase } from '../workspaceCandidate/copyAttestedWorkspaceDatabase.js';
import { createProfileInspectionDatabaseFactory } from './createProfileInspectionDatabase.js';
import { profileInspectionSqliteError } from './profileInspectionSqliteError.js';
import {
  createProfileBackupIdentity,
  inspectSqliteProfileConnectionWithReferences,
  type SqliteProfileDatabaseInspection,
} from './inspectSqliteProfileDatabase.js';
import {
  bindProfileInspectionFile,
  inspectProfileInspectionRoot,
  sameProfileInspectionBinding,
  sameProfileInspectionPath,
  type ProfileInspectionFileBinding,
} from './profileInspectionFileBinding.js';
import {
  isSafeLogicalPath,
  maximumInvoicePdfBytes,
  maximumProfileArtifactBytes,
  type ValidatedProfileArtifact,
} from './validateProfileArtifactCatalog.js';

type RestoreContentSlot = 'active' | 'staged';

export interface ColdProfileInspectionOperation {
  readonly kind: 'inspectColdRestoreContent';
  readonly operationId: string;
  readonly stagingRoot: string;
  readonly inspectionRoot: string;
  readonly workspaceRoot: string;
  readonly databaseSlot: RestoreContentSlot;
  readonly documentsSlot: RestoreContentSlot;
  readonly migrationsDirectory: string;
  readonly nativeResourceRoot: string;
}

/** No portable catalog file is asserted by this phase-selected content receipt. */
export interface ColdProfileInspectionContentReceipt {
  readonly documentBindings: { readonly byteSize: number; readonly sha256: string };
  readonly artifactCount: number;
  readonly artifactTotalByteSize: number;
  readonly artifactIdentity: string;
  readonly databaseHealth: 'healthy';
  readonly profileId: string;
  readonly migrationChainIdentity: string;
  readonly migrationPolicy: 'restoreCompatible';
  readonly databaseSlot: RestoreContentSlot;
  readonly documentsSlot: RestoreContentSlot;
  readonly database: { readonly byteSize: number; readonly sha256: string };
}

type OriginalContentSlot = 'active' | 'rollback' | 'absent';

export interface ColdOriginalProfileInspectionOperation {
  readonly kind: 'inspectColdRestoreOriginal';
  readonly operationId: string;
  readonly anchorRoot: string;
  readonly inspectionRoot: string;
  readonly workspaceRoot: string;
  readonly layout: 'profileRestore' | 'workspaceReplacement';
  readonly databaseSlot: OriginalContentSlot;
  readonly documentsSlot: OriginalContentSlot;
  readonly migrationsDirectory: string;
  readonly nativeResourceRoot: string;
}

type SelectedContentReceipt = Omit<ColdProfileInspectionContentReceipt, 'databaseSlot' | 'documentsSlot'>;
export type ColdOriginalProfileInspectionReceipt = {
  readonly sourceRole: 'original';
  readonly layout: ColdOriginalProfileInspectionOperation['layout'];
  readonly documentsSlot: OriginalContentSlot;
} & ({ readonly databaseSlot: 'absent' } | (SelectedContentReceipt & { readonly databaseSlot: 'active' | 'rollback' }));

interface ColdInspectionControl {
  readonly signal: AbortSignal;
  readonly assertOwned: () => Promise<void>;
  readonly createArtifactIdentity: (artifacts: readonly ValidatedProfileArtifact[]) => string;
  readonly writeDocumentBindings: (artifacts: readonly ValidatedProfileArtifact[]) =>
    Promise<{ readonly byteSize: number; readonly sha256: string }>;
}

/** Utility-only operation; its caller owns slot census, journal and proven exit. */
export async function runColdProfileInspection(
  input: Readonly<ColdProfileInspectionOperation>,
  control: ColdInspectionControl,
): Promise<ColdProfileInspectionContentReceipt> {
  input = Object.freeze({ ...input });
  assertInput(input);
  const operationRoot = join(input.stagingRoot, input.operationId);
  const runtimeRoot = join(input.workspaceRoot, 'runtime');
  const databasePath = input.databaseSlot === 'active'
    ? join(runtimeRoot, 'data', 'eky.sqlite') : join(operationRoot, 'profile.sqlite');
  const documentsRoot = input.documentsSlot === 'active'
    ? join(runtimeRoot, 'storage', 'invoices') : join(operationRoot, 'activation', 'storage', 'invoices');
  const content = await inspectSelectedContent(input, { operationRoot, databasePath, documentsRoot }, control);
  return Object.freeze({ ...content, databaseSlot: input.databaseSlot, documentsSlot: input.documentsSlot });
}

/** Original absence is selected by main's frozen journal/census, not inferred here. */
export async function runColdOriginalProfileInspection(
  input: Readonly<ColdOriginalProfileInspectionOperation>,
  control: ColdInspectionControl,
): Promise<ColdOriginalProfileInspectionReceipt> {
  input = Object.freeze({ ...input });
  const rollbackOperationRoot = resolveOriginalRollbackRoot(input);
  const original = { sourceRole: 'original' as const, layout: input.layout, documentsSlot: input.documentsSlot };
  const runtimeRoot = join(input.workspaceRoot, 'runtime');
  const documentsRoot = input.documentsSlot === 'absent' ? undefined : input.documentsSlot === 'active'
    ? join(runtimeRoot, 'storage', 'invoices') : join(rollbackOperationRoot, 'storage', 'invoices');
  if (input.databaseSlot === 'absent') {
    const assertOwned = async () => {
      if (control.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
      await control.assertOwned();
      if (control.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    };
    await assertOwned();
    const roots = [input.anchorRoot, input.workspaceRoot, input.inspectionRoot,
      ...(documentsRoot === undefined ? [] : [documentsRoot])];
    const identities = await Promise.all(roots.map(root => inspectProfileInspectionRoot(root)));
    if ((await readdir(input.inspectionRoot)).length !== 0) throw invalid();
    await assertOwned();
    for (let index = 0; index < roots.length; index += 1) {
      if (await inspectProfileInspectionRoot(roots[index]!) !== identities[index]) throw invalid();
    }
    if (control.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    // Do not open/create a DB, read an opaque catalog, or fabricate bindings.
    return Object.freeze({ ...original, databaseSlot: 'absent' as const });
  }
  const databasePath = input.databaseSlot === 'active'
    ? join(runtimeRoot, 'data', 'eky.sqlite') : join(rollbackOperationRoot, 'data', 'eky.sqlite');
  const content = await inspectSelectedContent(input,
    { operationRoot: input.anchorRoot, databasePath, documentsRoot }, control);
  return Object.freeze({ ...original, ...content, databaseSlot: input.databaseSlot });
}

async function inspectSelectedContent(
  input: Readonly<Pick<ColdProfileInspectionOperation, 'inspectionRoot' | 'workspaceRoot' | 'migrationsDirectory' | 'nativeResourceRoot'>>,
  paths: { readonly operationRoot: string; readonly databasePath: string; readonly documentsRoot: string | undefined },
  control: ColdInspectionControl,
): Promise<SelectedContentReceipt> {
  const assertOwned = async () => {
    if (control.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
    await control.assertOwned();
    if (control.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
  };
  await assertOwned();
  // Native provenance/budget must precede schema or business reads of the copy.
  const factory = await createProfileInspectionDatabaseFactory(input.nativeResourceRoot);
  await assertOwned();
  const { operationRoot, databasePath, documentsRoot } = paths;
  const roots = [...new Set([operationRoot, input.workspaceRoot, dirname(databasePath), input.inspectionRoot,
    ...(documentsRoot === undefined ? [] : [documentsRoot])])];
  const identities = new Map<string, string>();
  for (const root of roots) identities.set(root, await inspectProfileInspectionRoot(root));
  const assertRoots = async () => {
    for (const [root, identity] of identities) {
      if (await inspectProfileInspectionRoot(root) !== identity) throw invalid();
    }
  };
  if ((await readdir(input.inspectionRoot)).length !== 0) throw invalid();
  const databaseBefore = await bindProfileInspectionFile(databasePath, Number.MAX_SAFE_INTEGER, control.signal);
  await assertOwned();
  const copyPath = join(input.inspectionRoot, 'profile.sqlite');
  await copyAttestedWorkspaceDatabase({ sourcePath: databasePath, destinationPath: copyPath,
    expectedBytes: databaseBefore, signal: control.signal });
  const copyBefore = await bindProfileInspectionFile(copyPath, Number.MAX_SAFE_INTEGER, control.signal);
  await assertRoots();
  if (copyBefore.byteSize !== databaseBefore.byteSize || copyBefore.sha256 !== databaseBefore.sha256) throw invalid();
  await assertOwned();
  await assertRoots();
  if (!sameProfileInspectionBinding(copyBefore,
    await bindProfileInspectionFile(copyPath, Number.MAX_SAFE_INTEGER, control.signal))) throw invalid();

  const database = factory.openReadonly(copyPath);
  let inspection: SqliteProfileDatabaseInspection;
  let artifacts: readonly InvoiceBackupArtifactCatalogItem[];
  const bindings: { readonly path: string; readonly binding: ProfileInspectionFileBinding }[] = [];
  const validated: ValidatedProfileArtifact[] = [];
  let artifactTotalByteSize = 0;
  let firstFailure: unknown;
  try {
    inspection = inspectSqliteProfileConnectionWithReferences(
      database, input.migrationsDirectory, 'restoreCompatible', factory.schemaReferences,
    );
    await assertOwned();
    artifacts = await new SqliteInvoiceBackupArtifactCatalog(
      database, selectInvoiceBackupArtifactCatalogSchema(inspection),
    ).listAuthoritativeArtifacts();
    if (artifacts.length > invoiceBackupArtifactMaximumCount || (documentsRoot === undefined && artifacts.length !== 0)) throw artifactsInvalid();
    const selectedPaths = new Set<string>();
    for (const artifact of artifacts) {
      await assertOwned();
      validateArtifact(artifact, inspection.profileId);
      const path = join(documentsRoot!, ...artifact.storagePath.split('/'));
      const identityPath = process.platform === 'win32' ? path.toLowerCase() : path;
      if (selectedPaths.has(identityPath)) throw artifactsInvalid();
      selectedPaths.add(identityPath);
      const binding = await bindProfileInspectionFile(path, maximumInvoicePdfBytes, control.signal, Buffer.from('%PDF-', 'ascii'));
      if (binding.byteSize !== artifact.sizeBytes || binding.sha256 !== artifact.sha256) throw artifactsInvalid();
      artifactTotalByteSize += binding.byteSize;
      if (!Number.isSafeInteger(artifactTotalByteSize) || artifactTotalByteSize > maximumProfileArtifactBytes) throw artifactsInvalid();
      bindings.push({ path, binding });
      validated.push({ byteSize: binding.byteSize, sha256: binding.sha256, storagePath: artifact.storagePath,
        logicalPath: `artifacts/invoicing/invoice-documents/${createHash('sha256').update(artifact.documentId, 'utf8').digest('hex')}.pdf` });
    }
    await assertOwned();
  } catch (error) {
    firstFailure = profileInspectionSqliteError(error);
    throw firstFailure;
  } finally {
    try { database.close(); }
    catch (error) {
      throw new AggregateError([...(firstFailure === undefined ? [] : [firstFailure]), error],
        'PROFILE_INSPECTION_DATABASE_CLOSE_FAILED');
    }
  }

  // A closed copy is not enough: rebind all selected source bytes after awaits.
  await assertOwned();
  await assertRoots();
  await assertOwned();
  // Finish the utility-owned output before the final source-byte admission.
  const documentBindings = await control.writeDocumentBindings(Object.freeze(validated.map(artifact => Object.freeze({ ...artifact }))));
  // Complete caller authority awaits before rebinding any terminal PDF bytes.
  for (let index = 0; index < bindings.length; index += 1) await assertOwned();
  for (const { path, binding } of bindings) {
    if (!sameProfileInspectionBinding(binding,
      await bindProfileInspectionFile(path, maximumInvoicePdfBytes, control.signal, Buffer.from('%PDF-', 'ascii')))) throw artifactsInvalid();
  }
  const databaseAfter = await bindProfileInspectionFile(databasePath, Number.MAX_SAFE_INTEGER, control.signal);
  const copyAfter = await bindProfileInspectionFile(copyPath, Number.MAX_SAFE_INTEGER, control.signal);
  await assertRoots();
  if (!sameProfileInspectionBinding(databaseBefore, databaseAfter) || !sameProfileInspectionBinding(copyBefore, copyAfter)) throw invalid();
  if (control.signal.aborted) throw new Error('PROFILE_INSPECTION_TIMEOUT');
  const artifactIdentity = control.createArtifactIdentity(validated);
  if (!/^[a-f0-9]{64}$/.test(artifactIdentity)) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return Object.freeze({ artifactCount: artifacts.length, artifactTotalByteSize, artifactIdentity,
    documentBindings: Object.freeze({ ...documentBindings }),
    databaseHealth: 'healthy', profileId: inspection.profileId, migrationChainIdentity: inspection.migrationChainIdentity,
    migrationPolicy: 'restoreCompatible',
    database: Object.freeze({ byteSize: databaseAfter.byteSize, sha256: databaseAfter.sha256 }) });
}

function resolveOriginalRollbackRoot(input: Readonly<ColdOriginalProfileInspectionOperation>): string {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (input.kind !== 'inspectColdRestoreOriginal' || !uuid.test(input.operationId) ||
      !['active', 'rollback', 'absent'].includes(input.databaseSlot) || !['active', 'rollback', 'absent'].includes(input.documentsSlot) ||
      [input.anchorRoot, input.inspectionRoot, input.workspaceRoot, input.migrationsDirectory, input.nativeResourceRoot]
        .some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) ||
      !sameProfileInspectionPath(dirname(input.inspectionRoot), dirname(input.anchorRoot)) ||
      !/^profile-inspection-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(basename(input.inspectionRoot))) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
  if (input.layout === 'profileRestore') {
    const runtimeRoot = join(input.workspaceRoot, 'runtime');
    if (!sameProfileInspectionPath(input.anchorRoot, join(runtimeRoot, 'failed-profile-restores', input.operationId))) {
      throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
    }
    return join(runtimeRoot, 'profile-restore-rollback', input.operationId);
  }
  const activationRoot = dirname(dirname(input.anchorRoot));
  const installationRoot = dirname(dirname(activationRoot));
  if (input.layout !== 'workspaceReplacement' ||
      !sameProfileInspectionPath(input.anchorRoot,
        join(installationRoot, 'workspace-replacement-operations', 'activation', 'failed', input.operationId)) ||
      !sameProfileInspectionPath(dirname(input.workspaceRoot), join(installationRoot, 'workspaces')) ||
      !uuid.test(basename(input.workspaceRoot))) throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  return join(activationRoot, 'rollback', input.operationId);
}

function assertInput(input: Readonly<ColdProfileInspectionOperation>): void {
  if (input.kind !== 'inspectColdRestoreContent' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(input.operationId) ||
      !['active', 'staged'].includes(input.databaseSlot) || !['active', 'staged'].includes(input.documentsSlot) ||
      [input.stagingRoot, input.inspectionRoot, input.workspaceRoot, input.migrationsDirectory, input.nativeResourceRoot]
        .some(path => typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path || path.includes('\0')) ||
      !sameProfileInspectionPath(dirname(input.inspectionRoot), input.stagingRoot) ||
      !/^profile-inspection-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(basename(input.inspectionRoot))) {
    throw new Error('PROFILE_INSPECTION_PROTOCOL_INVALID');
  }
}

function validateArtifact(artifact: InvoiceBackupArtifactCatalogItem, profileId: string): void {
  const text = [artifact.companyId, artifact.documentId, artifact.invoiceId, artifact.fileName];
  if (text.some(value => typeof value !== 'string' || value === '' ||
      Buffer.byteLength(value, 'utf8') > invoiceBackupArtifactMaximumTextBytes || /[\u0000-\u001f\u007f]/u.test(value)) ||
      !isSafeLogicalPath(artifact.storagePath) || !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
      !Number.isSafeInteger(artifact.sizeBytes) || artifact.sizeBytes < 5 || artifact.sizeBytes > maximumInvoicePdfBytes ||
      artifact.documentType !== 'approved_invoice_pdf' || artifact.mediaType !== 'application/pdf' ||
      createProfileBackupIdentity(artifact.companyId) !== profileId) throw artifactsInvalid();
}

function invalid(): Error { return new Error('PROFILE_SNAPSHOT_VALIDATION_FAILED'); }
function artifactsInvalid(): Error { return new Error('PROFILE_SNAPSHOT_ARTIFACTS_INVALID'); }
