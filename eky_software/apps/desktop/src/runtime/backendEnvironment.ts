const allowedOperatingSystemEnvironmentKeys = [
  'PATH',
  'SystemRoot',
  'TEMP',
  'TMP',
  'WINDIR',
] as const;

export function createDesktopBackendEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const environment: Record<string, string> = { NODE_ENV: 'production' };
  const sourceEntries = Object.entries(source);

  for (const allowedKey of allowedOperatingSystemEnvironmentKeys) {
    const entry = sourceEntries.find(
      ([sourceKey, value]) =>
        sourceKey.toLowerCase() === allowedKey.toLowerCase() &&
        value !== undefined,
    );

    if (entry?.[1] !== undefined) {
      environment[allowedKey] = entry[1];
    }
  }

  return environment;
}
