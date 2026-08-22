import {
  WorkspaceBackupImportError,
  mapWorkspaceBackupImportError,
} from './workspaceBackupImportError.js';
import type {
  HistoricalPublishedWorkspaceValidationPort,
  PublishedHistoricalWorkspaceReadiness,
  PublishedWorkspaceBackupValidationInput,
  WorkspaceBackupCandidateMigrationInput,
  WorkspaceBackupCandidateMigrationResult,
  WorkspaceBackupCandidatePort,
  WorkspaceBackupCandidateReadiness,
  WorkspaceBackupCandidateValidationInput,
} from './workspaceBackupImportPorts.js';

export interface PrivateWorkspaceBackupCandidateRuntime {
  stopAndProveHandlesClosed(): Promise<boolean>;
  inspectStoppedMigrationResult?(): Promise<
    Readonly<WorkspaceBackupCandidateMigrationResult>
  >;
  inspectStoppedReadiness?(): Promise<
    Readonly<WorkspaceBackupCandidateReadiness>
  >;
  inspectStoppedHistoricalReadiness?(): Promise<
    Readonly<PublishedHistoricalWorkspaceReadiness>
  >;
}

export interface PrivateWorkspaceBackupCandidateRuntimeFactory {
  startMigration(
    input: Readonly<WorkspaceBackupCandidateMigrationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime>;
  startValidation(
    input: Readonly<WorkspaceBackupCandidateValidationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime>;
  startPublishedValidation(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime>;
  startHistoricalPublishedValidation(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<PrivateWorkspaceBackupCandidateRuntime>;
}

export class PrivateWorkspaceBackupCandidateAdapter
  implements
    HistoricalPublishedWorkspaceValidationPort,
    WorkspaceBackupCandidatePort
{
  constructor(
    private readonly runtimeFactory: PrivateWorkspaceBackupCandidateRuntimeFactory,
  ) {}

  migrate(
    input: Readonly<WorkspaceBackupCandidateMigrationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateMigrationResult>> {
    return this.runMigration(input);
  }

  validateAndMaterialize(
    input: Readonly<WorkspaceBackupCandidateValidationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
    return this.runValidation(input, false);
  }

  validatePublished(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
    return this.runValidation(input, true);
  }

  validateHistoricalPublished(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<Readonly<PublishedHistoricalWorkspaceReadiness>> {
    return this.runHistoricalPublishedValidation(input);
  }

  private async runHistoricalPublishedValidation(
    input: Readonly<PublishedWorkspaceBackupValidationInput>,
  ): Promise<Readonly<PublishedHistoricalWorkspaceReadiness>> {
    const runtime = await this.startRuntime(
      () => this.runtimeFactory.startHistoricalPublishedValidation(input),
      'recovery',
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
    );
    const handlesClosed = await this.stopRuntime(
      runtime,
      'recovery',
      'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
    );
    if (runtime.inspectStoppedHistoricalReadiness === undefined) {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
    }
    try {
      return Object.freeze({
        ...(await runtime.inspectStoppedHistoricalReadiness()),
        handlesClosed,
      });
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
        'recovery',
      );
    }
  }

  private async runMigration(
    input: Readonly<WorkspaceBackupCandidateMigrationInput>,
  ): Promise<Readonly<WorkspaceBackupCandidateMigrationResult>> {
    const runtime = await this.startRuntime(
      () => this.runtimeFactory.startMigration(input),
      'candidateMigration',
      'WORKSPACE_IMPORT_MIGRATION_FAILED',
    );
    const handlesClosed = await this.stopRuntime(
      runtime,
      'candidateMigration',
      'WORKSPACE_IMPORT_MIGRATION_FAILED',
    );
    if (runtime.inspectStoppedMigrationResult === undefined) {
      throw new WorkspaceBackupImportError(
        'WORKSPACE_IMPORT_MIGRATION_FAILED',
        'candidateMigration',
      );
    }
    try {
      return Object.freeze({
        ...(await runtime.inspectStoppedMigrationResult()),
        handlesClosed,
      });
    } catch (error) {
      throw mapWorkspaceBackupImportError(
        error,
        'WORKSPACE_IMPORT_MIGRATION_FAILED',
        'candidateMigration',
      );
    }
  }

  private async runValidation(
    input:
      | Readonly<WorkspaceBackupCandidateValidationInput>
      | Readonly<PublishedWorkspaceBackupValidationInput>,
    published: boolean,
  ): Promise<Readonly<WorkspaceBackupCandidateReadiness>> {
    const code = published
      ? 'WORKSPACE_IMPORT_RECOVERY_REQUIRED'
      : 'WORKSPACE_IMPORT_VALIDATION_FAILED';
    const stage = published ? 'recovery' : 'candidateValidation';
    const runtime = await this.startRuntime(
      () =>
        published
          ? this.runtimeFactory.startPublishedValidation(
              input as Readonly<PublishedWorkspaceBackupValidationInput>,
            )
          : this.runtimeFactory.startValidation(
              input as Readonly<WorkspaceBackupCandidateValidationInput>,
            ),
      stage,
      code,
    );
    const handlesClosed = await this.stopRuntime(runtime, stage, code);
    if (runtime.inspectStoppedReadiness === undefined) {
      throw new WorkspaceBackupImportError(code, stage);
    }
    try {
      return Object.freeze({
        ...(await runtime.inspectStoppedReadiness()),
        handlesClosed,
      });
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, code, stage);
    }
  }

  private async startRuntime(
    start: () => Promise<PrivateWorkspaceBackupCandidateRuntime>,
    stage: 'candidateMigration' | 'candidateValidation' | 'recovery',
    code:
      | 'WORKSPACE_IMPORT_MIGRATION_FAILED'
      | 'WORKSPACE_IMPORT_VALIDATION_FAILED'
      | 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
  ): Promise<PrivateWorkspaceBackupCandidateRuntime> {
    try {
      return await start();
    } catch (error) {
      throw mapWorkspaceBackupImportError(error, code, stage);
    }
  }

  private async stopRuntime(
    runtime: PrivateWorkspaceBackupCandidateRuntime,
    stage: 'candidateMigration' | 'candidateValidation' | 'recovery',
    code:
      | 'WORKSPACE_IMPORT_MIGRATION_FAILED'
      | 'WORKSPACE_IMPORT_VALIDATION_FAILED'
      | 'WORKSPACE_IMPORT_RECOVERY_REQUIRED',
  ): Promise<true> {
    try {
      if (await runtime.stopAndProveHandlesClosed()) return true;
    } catch {
      // The second bounded stop below is the only permitted cleanup retry.
    }
    try {
      if (await runtime.stopAndProveHandlesClosed()) return true;
    } catch {
      // Mapped to the operation's safe boundary below.
    }
    throw new WorkspaceBackupImportError(code, stage);
  }
}
