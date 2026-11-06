export interface ProfileRestoreColdCleanupContext {
  assertReadOwnership(): Promise<void>;
  assertMutationCurrent(): void;
}

export function assertSynchronousProfileRestoreMutationAuthority(assertCurrent: () => void): void {
  const result: unknown = assertCurrent();
  if (result !== undefined) {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error('PROFILE_RESTORE_ACTIVATION_STATE_INVALID');
  }
}
