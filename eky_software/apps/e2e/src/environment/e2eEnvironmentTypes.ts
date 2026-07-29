export interface E2eWorkerPaths {
  artifactsRoot: string;
  databaseFilePath: string;
  documentsRoot: string;
  incidentsRoot: string;
  logsRoot: string;
  runtimeConfigPath: string;
  supportBundlesRoot: string;
  tempRoot: string;
  workerRoot: string;
}

export interface E2eSafetyBoundaryInput {
  backendHost: string;
  environment: Readonly<Record<string, string | undefined>>;
  paths: E2eWorkerPaths;
  productionUserDataPath?: string;
  runRoot: string;
  smtpAdapter: string;
  urls: readonly string[];
  webHost: string;
}
