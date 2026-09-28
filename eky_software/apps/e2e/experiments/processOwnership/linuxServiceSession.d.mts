import type { E2eFixtureLifetime } from '../../src/environment/e2eFixtureLifetime.js';
import type { ProcessOutput } from '../../src/environment/boundedProcessOutput.js';
import type { E2eProcessStartupObservation } from '../../src/environment/e2eProcessStartupObservation.js';
import type { E2eBackendWorkload } from '../../src/environment/e2eBackendWorkload.js';
import type { ChromiumConnectionOwner } from '../../src/environment/connectOwnedChromium.js';

export interface LinuxServiceInput {
  readonly repositoryRoot: string;
  readonly runRoot: string;
  readonly lifetime: E2eFixtureLifetime;
  readonly startupDeadline: number;
  readonly redactedValues: readonly string[];
}
export interface LinuxBackendServiceInput extends LinuxServiceInput { readonly runtimeConfigPath: string; }
export interface LinuxChromiumServiceInput extends LinuxServiceInput { readonly browserExecutable: string; }
export interface LinuxViteServiceInput extends LinuxServiceInput {
  readonly webPort: number;
  readonly environmentRoot: string;
  readonly backendOrigin: string;
  readonly sessionSecret: string;
}
export interface OwnedLinuxService extends ProcessOutput {
  readonly startup: E2eProcessStartupObservation;
  readonly workload: E2eBackendWorkload;
  stop(): Promise<void>;
}
export interface OwnedLinuxChromiumService extends OwnedLinuxService {
  readonly connectionOwner: ChromiumConnectionOwner;
}
export interface LinuxServiceStartupFailureEvidence {
  readonly spawnObserved: boolean;
  readonly exitedBeforeCleanup: boolean;
  readonly processTree: 'stopped' | 'unverified';
  readonly startupFailure: 'preparationFailed' | 'startupDeadlineExceeded' | 'launchFailed' | 'workloadExited' | 'observationLost';
}
export class OwnedLinuxServiceStartupFailure extends Error implements ProcessOutput {
  constructor(profile: 'backend' | 'vite' | 'chromium', evidence: LinuxServiceStartupFailureEvidence, output: ProcessOutput);
  readonly evidence: Readonly<LinuxServiceStartupFailureEvidence>;
  readonly readStdout: () => string;
  readonly readStderr: () => string;
}
export function startLinuxService(profile: 'backend', input: LinuxBackendServiceInput): Promise<OwnedLinuxService>;
export function startLinuxService(profile: 'vite', input: LinuxViteServiceInput): Promise<OwnedLinuxService>;
export function startLinuxService(profile: 'chromium', input: LinuxChromiumServiceInput): Promise<OwnedLinuxChromiumService>;
