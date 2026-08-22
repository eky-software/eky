import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { createDesktopProfilePaths } from '../src/runtime/desktopProfilePaths.js';
import { createProfileSnapshotRuntimePaths } from '../src/profileBackup/profileSnapshotRuntimePaths.js';
import { validateWorkspaceCreationOperationId } from '../src/workspaces/creation/workspaceCreationOperationId.js';
import { deriveWorkspaceRoot } from '../src/workspaces/registry/deriveWorkspaceRoot.js';
import { validateWorkspaceId } from '../src/workspaces/registry/workspaceIdValidation.js';
import type {
  LocalWorkspaceRegistryV1,
  WorkspaceId,
} from '../src/workspaces/registry/workspaceRegistryTypes.js';
import { validateWorkspaceRegistry } from '../src/workspaces/registry/workspaceRegistryValidation.js';
import { ElectronWorkspaceCandidateRuntimeFactory } from '../src/workspaces/runtime/electronWorkspaceCandidateRuntimeFactory.js';
import { resolveWorkspaceCandidateRuntimePaths } from '../src/workspaces/runtime/workspaceCandidateRuntimePaths.js';
import { PrivateWorkspaceBackupCandidateAdapter } from '../src/workspaces/import/privateWorkspaceBackupCandidateAdapter.js';
import { generateWorkspaceBackupImportOperationId } from '../src/workspaces/import/workspaceBackupImportOperationId.js';
import type { PublishedHistoricalWorkspaceReadiness } from '../src/workspaces/import/workspaceBackupImportPorts.js';
import type { WorkspaceMigrationInspectionResult } from '../src/workspaces/update/workspaceMigrationInventoryTypes.js';

export interface WorkspaceFirstStartProofFixture {
  readonly artifactRoot: string;
  readonly businessArtifactPath: string;
  readonly databaseFilePath: string;
  readonly profileId: string;
  readonly workspaceId: WorkspaceId;
  readonly workspaceRoot: string;
}

export interface WorkspaceFirstStartProofBusinessSnapshot {
  readonly artifactSha256: string;
  readonly artifactSize: number;
  readonly businessRowsSha256: string;
}

export interface WorkspaceFirstStartProofFactories {
  readonly current: ElectronWorkspaceCandidateRuntimeFactory;
  readonly historical: ElectronWorkspaceCandidateRuntimeFactory;
  readonly runnerPath: string;
  cleanup(): Promise<void>;
}

interface FileSnapshot {
  readonly mtimeMs: number;
  readonly sha256: string;
  readonly size: number;
}

export async function createWorkspaceFirstStartProofFactories(input: {
  readonly appVersion: string;
  readonly buildRevision: string;
  readonly resourcesPath: string;
}): Promise<Readonly<WorkspaceFirstStartProofFactories>> {
  const runtimePaths = await resolveWorkspaceCandidateRuntimePaths(
    input.resourcesPath,
  );
  const historicalMigrationsDirectory = join(
    runtimePaths.backendRoot,
    'dist',
    'database',
    `e2e-workspace-first-start-prefix-${randomUUID()}`,
  );
  await createHistoricalMigrationPrefix({
    destination: historicalMigrationsDirectory,
    source: runtimePaths.migrationsDirectory,
  });
  const common = {
    appVersion: input.appVersion,
    backendRoot: runtimePaths.backendRoot,
    buildRevision: input.buildRevision,
    runnerPath: runtimePaths.runnerPath,
  } as const;
  return Object.freeze({
    current: new ElectronWorkspaceCandidateRuntimeFactory({
      ...common,
      migrationsDirectory: runtimePaths.migrationsDirectory,
    }),
    historical: new ElectronWorkspaceCandidateRuntimeFactory({
      ...common,
      migrationsDirectory: historicalMigrationsDirectory,
    }),
    runnerPath: runtimePaths.runnerPath,
    async cleanup() {
      await makeDirectoryRemovable(historicalMigrationsDirectory);
      await rm(historicalMigrationsDirectory, {
        force: true,
        recursive: true,
      });
    },
  });
}

export async function createWorkspaceFirstStartProofFixture(input: {
  readonly factory: ElectronWorkspaceCandidateRuntimeFactory;
  readonly userDataRoot: string;
}): Promise<Readonly<WorkspaceFirstStartProofFixture>> {
  const workspaceId = validateWorkspaceId(randomUUID());
  const workspaceRoot = deriveWorkspaceRoot(
    input.userDataRoot,
    workspaceId,
    1,
  ).workspaceRoot;
  const profile = createDesktopProfilePaths(workspaceRoot);
  assertWindowsSnapshotPathBudget(profile.runtimeRoot);
  await createPrivateDirectory(dirname(profile.databaseFilePath));
  await createPrivateDirectory(profile.invoiceDocumentStorageRoot);
  const runtime = await input.factory.start({
    artifactRoot: profile.invoiceDocumentStorageRoot,
    candidateRoot: workspaceRoot,
    databaseFilePath: profile.databaseFilePath,
    operationId: validateWorkspaceCreationOperationId(randomUUID()),
    workspaceId,
  });
  if (!(await runtime.stopAndProveHandlesClosed())) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_HANDLES_OPEN');
  }
  const readiness = await runtime.inspectStoppedReadiness();
  const businessFixture = seedWorkspaceFirstStartProofBusinessData({
    databaseFilePath: profile.databaseFilePath,
  });
  const artifactPath = join(
    profile.invoiceDocumentStorageRoot,
    ...businessFixture.storagePath.split('/'),
  );
  await createPrivateDirectory(dirname(artifactPath));
  await writeFile(artifactPath, businessFixture.pdfBytes, { mode: 0o600 });
  return Object.freeze({
    artifactRoot: profile.invoiceDocumentStorageRoot,
    businessArtifactPath: artifactPath,
    databaseFilePath: profile.databaseFilePath,
    profileId: readiness.lineageIdentity.profileId,
    workspaceId,
    workspaceRoot,
  });
}

export async function snapshotWorkspaceFirstStartProofBusinessData(
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<Readonly<WorkspaceFirstStartProofBusinessSnapshot>> {
  const database = new DatabaseSync(fixture.databaseFilePath, {
    open: true,
    readOnly: true,
  });
  let rows: readonly Record<string, unknown>[];
  try {
    rows = Object.freeze([
      ...(database
        .prepare(
          `
            SELECT
              id,
              company_id,
              customer_number,
              name,
              status
            FROM customers
            WHERE id = 'workspace-proof-customer'
          `,
        )
        .all() as Record<string, unknown>[]),
      ...(database
        .prepare(
          `
            SELECT
              id,
              company_id,
              source_draft_id,
              invoice_number,
              status,
              total_net_cents,
              total_vat_cents,
              total_gross_cents
            FROM invoices
            WHERE id = 'workspace-proof-invoice'
          `,
        )
        .all() as Record<string, unknown>[]),
      ...(database
        .prepare(
          `
            SELECT
              id,
              invoice_id,
              description,
              net_cents,
              vat_cents,
              gross_cents
            FROM invoice_lines
            WHERE id = 'workspace-proof-invoice-line'
          `,
        )
        .all() as Record<string, unknown>[]),
      ...(database
        .prepare(
          `
            SELECT
              id,
              company_id,
              invoice_id,
              storage_path,
              sha256,
              size_bytes
            FROM invoice_documents
            WHERE id = 'workspace-proof-document'
          `,
        )
        .all() as Record<string, unknown>[]),
    ]);
  } finally {
    database.close();
  }
  if (rows.length !== 4) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_BUSINESS_DATA_INVALID');
  }
  const artifact = await readFile(fixture.businessArtifactPath);
  return Object.freeze({
    artifactSha256: createHash('sha256').update(artifact).digest('hex'),
    artifactSize: artifact.byteLength,
    businessRowsSha256: createHash('sha256')
      .update(JSON.stringify(rows))
      .digest('hex'),
  });
}

function assertWindowsSnapshotPathBudget(runtimeRoot: string): void {
  if (process.platform !== 'win32') {
    return;
  }
  const snapshotPaths = createProfileSnapshotRuntimePaths(runtimeRoot);
  const representativeOperationId = '11111111-1111-4111-8111-111111111111';
  const representativeSnapshotPath = join(
    snapshotPaths.stagingRoot,
    representativeOperationId,
    'profile.sqlite',
  );

  if (representativeSnapshotPath.length >= 260) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_PATH_BUDGET_EXCEEDED');
  }
}

export function createWorkspaceFirstStartProofRegistry(
  fixtures: readonly Readonly<WorkspaceFirstStartProofFixture>[],
  activeWorkspaceId: WorkspaceId,
): Readonly<LocalWorkspaceRegistryV1> {
  return validateWorkspaceRegistry({
    activeWorkspaceId,
    formatVersion: 1,
    workspaces: fixtures.map((fixture, index) => ({
      createdAt: `2026-08-21T00:00:0${index}.000Z`,
      layoutVersion: 1 as const,
      lifecycleState: 'ready' as const,
      lineageIdentity: {
        formatVersion: 1 as const,
        profileId: fixture.profileId,
      },
      workspaceId: fixture.workspaceId,
      workspaceLabel: `First-start workspace ${index + 1}`,
    })),
  });
}

export async function inspectWorkspaceFirstStartProofFixture(
  factory: ElectronWorkspaceCandidateRuntimeFactory,
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<Readonly<WorkspaceMigrationInspectionResult>> {
  const runtime = await factory.startMigrationInspection({
    databaseFilePath: fixture.databaseFilePath,
    expectedProfileId: fixture.profileId,
    operationId: validateWorkspaceCreationOperationId(randomUUID()),
    publishedRoot: fixture.workspaceRoot,
  });
  try {
    if (!(await runtime.stopAndProveHandlesClosed())) {
      throw new Error('WORKSPACE_FIRST_START_PROOF_HANDLES_OPEN');
    }
    return await runtime.inspectStoppedMigrationInspection();
  } finally {
    await runtime.stopAndProveHandlesClosed().catch(() => false);
  }
}

export async function validateWorkspaceFirstStartProofHistoricalFixture(
  factory: ElectronWorkspaceCandidateRuntimeFactory,
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<Readonly<PublishedHistoricalWorkspaceReadiness>> {
  return new PrivateWorkspaceBackupCandidateAdapter(
    factory,
  ).validateHistoricalPublished({
    artifactRoot: fixture.artifactRoot,
    databaseFilePath: fixture.databaseFilePath,
    expectedProfileId: fixture.profileId,
    operationId: generateWorkspaceBackupImportOperationId(),
    publishedRoot: fixture.workspaceRoot,
    workspaceId: fixture.workspaceId,
  });
}

export async function corruptWorkspaceFirstStartProofDatabase(
  fixture: Readonly<WorkspaceFirstStartProofFixture>,
): Promise<void> {
  await writeFile(fixture.databaseFilePath, 'not a sqlite database', {
    encoding: 'utf8',
    mode: 0o600,
  });
}

export async function snapshotWorkspaceFirstStartProofFile(
  path: string,
): Promise<Readonly<FileSnapshot>> {
  const metadata = await stat(path);
  return Object.freeze({
    mtimeMs: metadata.mtimeMs,
    sha256: createHash('sha256').update(await readFile(path)).digest('hex'),
    size: metadata.size,
  });
}

export async function snapshotWorkspaceFirstStartProofDirectory(
  root: string,
): Promise<readonly string[]> {
  const snapshots: string[] = [];
  await appendDirectorySnapshot(root, root, snapshots);
  return Object.freeze(snapshots.sort());
}

export function workspaceFirstStartProofSnapshotsEqual(
  first: unknown,
  second: unknown,
): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

async function createHistoricalMigrationPrefix(input: {
  readonly destination: string;
  readonly source: string;
}): Promise<void> {
  await rm(input.destination, { force: true, recursive: true });
  await cp(input.source, input.destination, { recursive: true });
  if (process.platform !== 'win32') await chmod(input.destination, 0o700);
  const migrationNames = (await readdir(input.destination, {
    withFileTypes: true,
  }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort();
  const latestMigration = migrationNames.at(-1);
  if (latestMigration === undefined || migrationNames.length < 2) {
    throw new Error('WORKSPACE_FIRST_START_PROOF_PREFIX_INVALID');
  }
  await rm(join(input.destination, latestMigration));
  if (process.platform !== 'win32') await chmod(input.destination, 0o755);
}

function seedWorkspaceFirstStartProofBusinessData(input: {
  readonly databaseFilePath: string;
}): Readonly<{ pdfBytes: Buffer; storagePath: string }> {
  const database = new DatabaseSync(input.databaseFilePath);
  const pdfBytes = Buffer.from(
    '%PDF-1.7\n% Eky synthetic workspace activation proof\n',
    'utf8',
  );
  const pdfSha256 = createHash('sha256').update(pdfBytes).digest('hex');
  const createdAt = '2026-08-22T00:00:00.000Z';
  let transactionStarted = false;
  try {
    database.exec('PRAGMA foreign_keys = ON;');
    const identity = database
      .prepare(
        `
          SELECT company_id
          FROM local_runtime_identity
          WHERE singleton_key = 'local-runtime'
        `,
      )
      .get() as { company_id?: unknown } | undefined;
    const companyId = identity?.company_id;
    if (
      typeof companyId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,120}$/u.test(companyId)
    ) {
      throw new Error('WORKSPACE_FIRST_START_PROOF_COMPANY_ID_INVALID');
    }
    const storagePath = `${companyId}/workspace-proof-invoice/approved-invoice.pdf`;

    database.exec('BEGIN IMMEDIATE;');
    transactionStarted = true;
    database
      .prepare(
        `
          INSERT INTO customers (
            id,
            company_id,
            name,
            customer_number,
            customer_type,
            status,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-customer',
        companyId,
        'Synthetic Workspace Customer',
        'W6A3-1',
        'company',
        'active',
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `
          INSERT INTO invoice_drafts (
            id,
            company_id,
            customer_id,
            status,
            invoice_date,
            due_date,
            payment_term_days,
            price_input_mode,
            subject,
            net_total_cents,
            vat_total_cents,
            gross_total_cents,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-draft',
        companyId,
        'workspace-proof-customer',
        'draft',
        '2026-08-22',
        '2026-09-05',
        14,
        'net',
        'Synthetic workspace activation proof',
        10_000,
        2_550,
        12_550,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `
          INSERT INTO invoice_draft_lines (
            id,
            invoice_draft_id,
            position,
            description,
            quantity_hundredths,
            unit,
            unit_price_cents,
            vat_rate_basis_points,
            discount_type,
            discount_value,
            base_cents,
            discount_cents,
            net_cents,
            vat_cents,
            gross_cents
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-draft-line',
        'workspace-proof-draft',
        1,
        'Synthetic migration-safe work',
        100,
        'h',
        10_000,
        2_550,
        'none',
        0,
        10_000,
        0,
        10_000,
        2_550,
        12_550,
      );
    database
      .prepare(
        `
          INSERT INTO invoices (
            id,
            company_id,
            source_draft_id,
            invoice_number,
            series_key,
            sequence_scope,
            sequence_number,
            numbering_mode,
            status,
            customer_id,
            customer_number_snapshot,
            customer_name_snapshot,
            customer_type_snapshot,
            invoice_date,
            due_date,
            payment_term_days,
            price_input_mode,
            subject,
            total_net_cents,
            total_vat_cents,
            total_gross_cents,
            created_at,
            approved_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-invoice',
        companyId,
        'workspace-proof-draft',
        'W6A3-0001',
        'default',
        '2026',
        1,
        'calendarYearSequence',
        'approved',
        'workspace-proof-customer',
        'W6A3-1',
        'Synthetic Workspace Customer',
        'company',
        '2026-08-22',
        '2026-09-05',
        14,
        'net',
        'Synthetic workspace activation proof',
        10_000,
        2_550,
        12_550,
        createdAt,
        createdAt,
        createdAt,
      );
    database
      .prepare(
        `
          UPDATE invoice_drafts
          SET approved_invoice_id = ?, approved_at = ?
          WHERE id = ?
        `,
      )
      .run('workspace-proof-invoice', createdAt, 'workspace-proof-draft');
    database
      .prepare(
        `
          INSERT INTO invoice_lines (
            id,
            invoice_id,
            line_order,
            description,
            quantity_hundredths,
            unit,
            unit_price_cents,
            vat_rate_basis_points,
            discount_type,
            discount_value,
            base_cents,
            discount_cents,
            net_cents,
            vat_cents,
            gross_cents,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-invoice-line',
        'workspace-proof-invoice',
        1,
        'Synthetic migration-safe work',
        100,
        'h',
        10_000,
        2_550,
        'none',
        0,
        10_000,
        0,
        10_000,
        2_550,
        12_550,
        createdAt,
      );
    database
      .prepare(
        `
          INSERT INTO invoice_documents (
            id,
            company_id,
            invoice_id,
            document_type,
            file_name,
            storage_path,
            mime_type,
            sha256,
            size_bytes,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-document',
        companyId,
        'workspace-proof-invoice',
        'approved_invoice_pdf',
        'approved-invoice.pdf',
        storagePath,
        'application/pdf',
        pdfSha256,
        pdfBytes.byteLength,
        createdAt,
      );
    database
      .prepare(
        `
          INSERT INTO invoice_audit_events (
            id,
            company_id,
            actor_user_id,
            action,
            draft_id,
            invoice_id,
            invoice_number,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        'workspace-proof-audit',
        companyId,
        'local-owner',
        'invoice.approved',
        'workspace-proof-draft',
        'workspace-proof-invoice',
        'W6A3-0001',
        createdAt,
      );
    const foreignKeyViolations = database
      .prepare('PRAGMA foreign_key_check;')
      .all();
    if (foreignKeyViolations.length !== 0) {
      throw new Error('WORKSPACE_FIRST_START_PROOF_FOREIGN_KEY_INVALID');
    }
    database.exec('COMMIT;');
    transactionStarted = false;
    return Object.freeze({ pdfBytes, storagePath });
  } catch (error) {
    if (transactionStarted) {
      database.exec('ROLLBACK;');
    }
    throw error;
  } finally {
    database.close();
  }
}

async function appendDirectorySnapshot(
  root: string,
  current: string,
  snapshots: string[],
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const path = join(current, entry.name);
    const relativePath = relative(root, path).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      snapshots.push(`directory:${relativePath}`);
      await appendDirectorySnapshot(root, path, snapshots);
      continue;
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error('WORKSPACE_FIRST_START_PROOF_ARTIFACT_INVALID');
    }
    const snapshot = await snapshotWorkspaceFirstStartProofFile(path);
    snapshots.push(
      `file:${relativePath}:${snapshot.size}:${snapshot.mtimeMs}:${snapshot.sha256}`,
    );
  }
}

async function createPrivateDirectory(path: string): Promise<void> {
  await mkdir(path, { mode: 0o700, recursive: true });
  if (process.platform !== 'win32') await chmod(path, 0o700);
}

async function makeDirectoryRemovable(path: string): Promise<void> {
  if (process.platform !== 'win32') {
    await chmod(path, 0o700).catch(() => undefined);
  }
}
