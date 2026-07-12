export const authenticationModeValues = Object.freeze([
  'local',
  'firebase',
] as const);

export type AuthenticationMode = (typeof authenticationModeValues)[number];

export function isAuthenticationMode(
  value: unknown,
): value is AuthenticationMode {
  return (
    typeof value === 'string' &&
    authenticationModeValues.includes(value as AuthenticationMode)
  );
}
