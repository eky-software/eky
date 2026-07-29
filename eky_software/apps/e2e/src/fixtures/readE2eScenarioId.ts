export function readE2eScenarioId(title: string): string {
  const scenarioId = /\b[A-Z]+(?:-[A-Z]+)*-[0-9]{3}\b/.exec(title)?.[0];

  if (scenarioId === undefined) {
    throw new Error('E2E test title must contain a scenario id.');
  }

  return scenarioId;
}
