/** Private, invocation-bound authority; never inferred from a journal or busy state. */
export interface UpdateActiveProfileValidationContext {
  readonly operationId: string;
  readonly stage: 'preparation' | 'handoff';
  assertCurrent(): void;
  /** Only after owned work, snapshot removal and this invocation's fence checks settled. */
  confirmCleanup(): void;
}

export interface UpdateActiveProfileValidation {
  readonly artifactCount: number;
  readonly artifactTotalByteSize: number;
  readonly databaseHealth: 'healthy';
  readonly migrationChainIdentity: string;
}
