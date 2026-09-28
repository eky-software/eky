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
export interface LinuxServiceInputs {
  readonly backend: LinuxBackendServiceInput;
  readonly vite: LinuxViteServiceInput;
  readonly chromium: LinuxChromiumServiceInput;
}
export type LinuxServiceProfile = keyof LinuxServiceInputs;
interface LinuxServiceConfigurationFields {
  readonly backend: { readonly runtimeConfigPath: string };
  readonly vite: {
    readonly webPort: number;
    readonly environmentRoot: string;
    readonly backendOrigin: string;
    readonly sessionSecret: string;
  };
  readonly chromium: { readonly browserExecutable: string; readonly browserGeneration: string };
}
export type LinuxServiceConfiguration<P extends LinuxServiceProfile = LinuxServiceProfile> = {
  [K in P]: Readonly<{
    version: 1;
    profile: K;
    generation: string;
    uid: number;
    gid: number;
    root: string;
    repositoryRoot: string;
    runRoot: string;
    node: string;
    startUntil: string;
    workUntil: string;
    redactedValues: readonly string[];
  }> & LinuxServiceConfigurationFields[K];
}[P];
export interface PreparedLinuxService<P extends LinuxServiceProfile = LinuxServiceProfile> {
  readonly config: LinuxServiceConfiguration<P>;
  readonly rootIdentity: Readonly<{ dev: number; ino: number }>;
}
export interface LinuxServiceDeadline {
  remaining(phase: 'ready' | 'work' | 'wrapper'): number;
  check(phase: 'ready' | 'work' | 'wrapper'): void;
  beginCleanup(): void;
}
interface LinuxServiceCommandClosure {
  readonly reason: 'deadlineExceeded' | 'spawnFailed' | 'processError' | 'exitFailed' | 'terminalIncomplete' |
    'observationInvalid' | 'outputInvalid' | 'streamMissing' | 'streamError' | 'streamIncomplete' |
    'streamInvalid' | 'outputLimit' | 'stderrNotEmpty' | null;
  readonly accepted: boolean;
  readonly spawned: boolean;
  readonly exited: boolean;
  readonly commandCleanup: 'closed' | 'notStarted' | 'unverified';
  readonly terminationAttempted: boolean;
}
export interface LinuxServiceManager {
  prepare(): Promise<void>;
  launch(): Promise<void>;
  own(): Promise<void>;
  observe(): Promise<Readonly<{ waitingWrapper: 'pending' }> |
    Readonly<{ generation: string; waitingWrapper: 'normalExit' }>>;
  emergencyStop(): Promise<void>;
  settle(): Promise<readonly (LinuxServiceCommandClosure | undefined)[]>;
  mayHaveStarted(): boolean;
}
export interface LinuxServiceReply {
  readonly version: 1;
  readonly generation: string;
  readonly type: 'started' | 'snapshot' | 'stopping' | 'exit' | 'failed';
  readonly sequence: number;
  readonly state: 'pending' | 'running' | 'exited' | 'unavailable';
  readonly spawned: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly rssBytes: number | null;
}
export interface LinuxServiceControl {
  readonly opened: Promise<void>;
  readonly ready: Promise<void>;
  readonly closed: Promise<void>;
  request(type: 'go' | 'status' | 'rss' | 'stop'): Promise<LinuxServiceReply>;
  verifyClosed(): void;
  dispose(): Promise<void>;
}
// These synchronous factories wrap the existing owners; deadlines and cleanup
// authority remain with the session and manager implementations.
export interface LinuxServiceDependencies<P extends LinuxServiceProfile> {
  readonly prepare?: (profile: P, input: LinuxServiceInputs[P]) => PreparedLinuxService<P>;
  readonly createManager?: (config: LinuxServiceConfiguration<P>, deadline: LinuxServiceDeadline) => LinuxServiceManager;
  readonly listen?: (prepared: PreparedLinuxService<P>, deadline: LinuxServiceDeadline,
    onReply: (reply: LinuxServiceReply) => void, onLost: () => void) => LinuxServiceControl;
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
export function startLinuxService(profile: 'backend', input: LinuxBackendServiceInput,
  dependencies?: LinuxServiceDependencies<'backend'>): Promise<OwnedLinuxService>;
export function startLinuxService(profile: 'vite', input: LinuxViteServiceInput,
  dependencies?: LinuxServiceDependencies<'vite'>): Promise<OwnedLinuxService>;
export function startLinuxService(profile: 'chromium', input: LinuxChromiumServiceInput,
  dependencies?: LinuxServiceDependencies<'chromium'>): Promise<OwnedLinuxChromiumService>;
