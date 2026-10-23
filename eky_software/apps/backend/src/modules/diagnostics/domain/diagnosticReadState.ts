export const diagnosticReadIssueOrder = Object.freeze([
  'sourceUnavailable', 'invalidEntries', 'limitReached',
] as const);

export type DiagnosticReadIssue = (typeof diagnosticReadIssueOrder)[number];
export type DiagnosticReadState =
  | Readonly<{ status: 'complete'; reasons: readonly [] }>
  | Readonly<{ status: 'partial'; reasons: readonly DiagnosticReadIssue[] }>
  | Readonly<{ status: 'unavailable'; reasons: readonly ['notConfigured'] | readonly ['sourceUnavailable'] }>;

export const completeDiagnosticReadState: DiagnosticReadState = Object.freeze({
  status: 'complete', reasons: Object.freeze([] as const),
});
export const unavailableDiagnosticReadState: DiagnosticReadState = Object.freeze({
  status: 'unavailable', reasons: Object.freeze(['sourceUnavailable'] as const),
});
export const notConfiguredDiagnosticReadState: DiagnosticReadState = Object.freeze({
  status: 'unavailable', reasons: Object.freeze(['notConfigured'] as const),
});

export function createDiagnosticReadState(
  issues: ReadonlySet<DiagnosticReadIssue>,
  hasReadableSource: boolean,
): DiagnosticReadState {
  if (!hasReadableSource) return unavailableDiagnosticReadState;
  const reasons = diagnosticReadIssueOrder.filter(issue => issues.has(issue));
  return reasons.length === 0 ? completeDiagnosticReadState : { status: 'partial', reasons };
}
