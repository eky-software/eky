export const maximumOperationFailureDepth = 8;

export function readPrimaryOperationFailureCause<Cause extends string>(
  error: unknown,
  allowedCauses: readonly Cause[],
): Cause | undefined {
  const seen = new Set<unknown>();
  let current = error;
  let cause: Cause | undefined;
  try {
    for (let depth = 0; depth < maximumOperationFailureDepth; depth++) {
      if (!(current instanceof Error)) {
        return cause;
      }
      if (seen.has(current)) {
        return undefined;
      }
      seen.add(current);
      // Ordered aggregates keep the operation failure before recovery failures.
      if (current instanceof AggregateError) {
        cause = undefined;
        current = current.errors[0];
        continue;
      }
      const message = current.message;
      const allowed = allowedCauses.find(code => code === message);
      if (allowed !== undefined) {
        cause = allowed;
      }
      current = current.cause;
    }
    return current === undefined ? cause : undefined;
  } catch {
    return undefined;
  }
}
