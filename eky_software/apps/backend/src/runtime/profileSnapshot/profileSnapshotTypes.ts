export interface SqliteProfileSnapshotMetadata {
  databaseByteSize: number;
  logicalPath: 'profile.sqlite';
  sha256: string;
  totalPages: number;
}

export interface ProfileSnapshotArtifactCatalogMetadata {
  artifactCount: number;
  artifactTotalByteSize: number;
  catalogByteSize: number;
  logicalPath: 'snapshot-catalog-v1.json';
  sha256: string;
}

export interface ProfileSnapshotMetadata {
  artifactCatalog: ProfileSnapshotArtifactCatalogMetadata;
  database: SqliteProfileSnapshotMetadata;
}

export interface CreateProfileSnapshotInput {
  operationId: string;
  signal: AbortSignal;
}

export type ProfileSnapshotMigrationPolicy =
  | 'exactCurrentManifest'
  | 'compatibleHistoricalPrefix';

export interface CreateSqliteProfileSnapshotInput
  extends CreateProfileSnapshotInput {
  migrationPolicy: ProfileSnapshotMigrationPolicy;
}

export interface ProfileSnapshotService {
  createProfileSnapshot(
    input: CreateProfileSnapshotInput,
  ): Promise<ProfileSnapshotMetadata>;
  createPreMigrationProfileSnapshot(
    input: CreateProfileSnapshotInput,
  ): Promise<ProfileSnapshotMetadata>;
}

export interface ProfileSnapshotValidationMetadata {
  activeProfileIsEmpty: boolean;
  artifactCount: number;
  artifactTotalByteSize: number;
  databaseHealth: 'healthy';
  migrationChainIdentity: string;
  profileId: string;
  profileMatchesActive: boolean;
}

export interface ProfileSnapshotValidationService {
  validateProfileSnapshot(
    operationId: string,
  ): Promise<ProfileSnapshotValidationMetadata>;
}

export interface ProfileRestoreActivationPreparationMetadata {
  artifactCount: number;
  artifactTotalByteSize: number;
}

export interface ProfileRestoreActivationPreparationService {
  prepareProfileRestoreActivation(
    operationId: string,
  ): Promise<ProfileRestoreActivationPreparationMetadata>;
}

export interface ActiveProfileValidationMetadata {
  artifactCount: number;
  artifactTotalByteSize: number;
  databaseHealth: 'healthy';
  migrationChainIdentity: string;
}

export interface ActiveProfileValidationService {
  validateActiveProfile(): Promise<ActiveProfileValidationMetadata>;
}

export interface ProfileSnapshotRuntimeService
  extends ActiveProfileValidationService,
    ProfileSnapshotService,
    ProfileSnapshotValidationService,
    ProfileRestoreActivationPreparationService {}

export interface SqliteProfileSnapshotService {
  createSqliteSnapshot(
    input: CreateSqliteProfileSnapshotInput,
  ): Promise<SqliteProfileSnapshotMetadata>;
}

export interface ProfileSnapshotServiceRegistration {
  register(service: ProfileSnapshotRuntimeService): void;
  stagingRoot: string;
}
