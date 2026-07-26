import type { DesktopOperationalEvent } from './desktopOperationalEvent.js';

export interface DesktopOperationalLogger {
  write(event: DesktopOperationalEvent): void;
}

export const noOpDesktopOperationalLogger: DesktopOperationalLogger =
  Object.freeze({
    write() {},
  });
