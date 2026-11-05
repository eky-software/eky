import type { E2eFixtureLifetime } from '../../e2e/src/environment/e2eFixtureLifetime.js';

export interface PackagedSmokePhaseOutput {
  readonly phase: 'restoreRestart' | 'shutdown';
  readonly stdout: PackagedSmokeStream;
  readonly stderr: PackagedSmokeStream;
}

interface PackagedSmokeStream {
  readonly text: string;
  readonly truncated: boolean;
  readonly readFailed: boolean;
  readonly available: boolean;
  readonly ended: boolean;
  readonly changed: boolean;
  readonly partial: boolean;
}

interface PackagedSmokeBinding {
  readonly schemaVersion: 1;
  readonly runNonce: string;
  readonly scenario: string;
  readonly artifactDescriptorSha256: string;
}

interface PackagedSmokeJobOptions {
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  lifetime?: E2eFixtureLifetime;
}

interface PackagedSmokeJobInput {
  schemaVersion: 1;
  runNonce: string;
  artifactDescriptorSha256: string;
  startupException: boolean;
}

interface PackagedSmokeJobResult {
  readonly binding: PackagedSmokeBinding;
  readonly supervisorResult: PackagedSmokeBinding & Readonly<{ status: 'completed'; processTreeAbsent: true }>;
  readonly portRelease: Readonly<{ status: 'verified' | 'notStarted' | 'unverified' }>;
}

export function runOwnedPackagedSmokePhase(input: PackagedSmokeJobInput & {
  phase: 'initial' | 'restoredProfile' | 'selectorRecovery' | 'selectorRestart';
}, options?: PackagedSmokeJobOptions): Promise<PackagedSmokeJobResult & Readonly<{
  diagnostic: Readonly<{ status: 'verified'; phase: PackagedSmokePhaseOutput }> | Readonly<{ status: 'unavailable' }>;
}>>;

export function runOwnedPackagedSmokeWorkflow(input: PackagedSmokeJobInput & {
  phase: 'workspaceDeletion'; startupException: false;
}, options?: PackagedSmokeJobOptions): Promise<PackagedSmokeJobResult & Readonly<{
  diagnostic: Readonly<{ status: 'verified'; phases: readonly PackagedSmokePhaseOutput[] }> | Readonly<{ status: 'unavailable' }>;
  cleanup: Readonly<{ status: 'verified' | 'notAttempted' }>;
}>>;
