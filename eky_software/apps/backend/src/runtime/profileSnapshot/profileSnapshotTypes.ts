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

export type ProfileSnapshotMigrationPolicy =
  | 'exactCurrentManifest'
  | 'compatibleHistoricalPrefix';

export interface CreateProfileSnapshotInput {
  migrationPolicy: ProfileSnapshotMigrationPolicy;
  operationId: string;
  signal: AbortSignal;
}

export interface ProfileSnapshotService {
  createProfileSnapshot(
    input: CreateProfileSnapshotInput,
  ): Promise<ProfileSnapshotMetadata>;
}

export interface InspectedProfileSnapshotMetadata {
  artifactCount: number;
  artifactTotalByteSize: number;
  databaseHealth: 'healthy';
  migrationChainIdentity: string;
  profileId: string;
}

export interface ProfileInspectionContextMetadata {
  readonly activeProfileId: string;
  readonly activeProfileIsEmpty: boolean;
}

export interface ProfileInspectionContextReader {
  readProfileInspectionContext(): ProfileInspectionContextMetadata;
}

export interface ProfileRestoreActivationPreparationMetadata {
  artifactCount: number;
  artifactTotalByteSize: number;
}

export interface ActiveProfileValidationMetadata {
  artifactCount: number;
  artifactTotalByteSize: number;
  databaseHealth: 'healthy';
  migrationChainIdentity: string;
  profileId: string;
}

export interface ActiveProfileValidationService {
  validateActiveProfile(): Promise<ActiveProfileValidationMetadata>;
}

export interface ProfileSnapshotRuntimeService
  extends ProfileInspectionContextReader, ProfileSnapshotService {}

export interface SqliteProfileSnapshotService {
  createSqliteSnapshot(
    input: CreateProfileSnapshotInput,
  ): Promise<SqliteProfileSnapshotMetadata>;
}

export interface ProfileSnapshotServiceRegistration {
  register(service: ProfileSnapshotRuntimeService): void;
  stagingRoot: string;
}
