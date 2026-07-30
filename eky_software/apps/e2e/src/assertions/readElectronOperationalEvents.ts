import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ElectronOperationalEvent {
  eventName?: string;
  [key: string]: unknown;
}

export function readElectronOperationalEvents(
  logsRoot: string,
): ElectronOperationalEvent[] {
  return readJsonLineFiles(logsRoot);
}

function readJsonLineFiles(root: string): ElectronOperationalEvent[] {
  if (!existsSync(root)) {
    return [];
  }
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return readJsonLineFiles(path);
    }
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
      return [];
    }
    return readFileSync(path, 'utf8')
      .split(/\r?\n/u)
      .filter(Boolean)
      .flatMap(parseOperationalEvent);
  });
}

function parseOperationalEvent(line: string): ElectronOperationalEvent[] {
  try {
    const value = JSON.parse(line) as unknown;
    return typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value)
      ? [value as ElectronOperationalEvent]
      : [];
  } catch {
    throw new Error('Electron E2E operational log contains invalid JSON.');
  }
}
