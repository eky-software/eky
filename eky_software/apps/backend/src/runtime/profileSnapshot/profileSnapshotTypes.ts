export interface SqliteProfileSnapshotMetadata {
  databaseByteSize: number;
  logicalPath: 'profile.sqlite';
  sha256: string;
  totalPages: number;
}

export interface CreateSqliteProfileSnapshotInput {
  operationId: string;
  signal: AbortSignal;
}

export interface ProfileSnapshotService {
  createSqliteSnapshot(
    input: CreateSqliteProfileSnapshotInput,
  ): Promise<SqliteProfileSnapshotMetadata>;
}

export interface ProfileSnapshotServiceRegistration {
  register(service: ProfileSnapshotService): void;
  stagingRoot: string;
}
