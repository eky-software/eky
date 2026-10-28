import { join } from 'node:path';

import { readElectronOperationalEvents } from '../../src/assertions/readElectronOperationalEvents.js';
import { ELECTRON_E2E_GRACEFUL_EXIT_SAFETY_TIMEOUT_MILLISECONDS } from '../../src/fixtures/electronLaunchBudgets.js';
import { test, expect } from '../../src/fixtures/isolatedElectronTest.js';

test('DESK-WINDOW-CLOSE-001 @critical @recovery completes shutdown after the main window closes', async ({
  e2eElectron,
}) => {
  const { electronApp, page, runtime } = e2eElectron;
  const mainWindow = await electronApp.browserWindow(page);
  let settleClose: ((result: 'closed' | 'timedOut' | 'cancelled') => void) | undefined;
  const applicationClosed = new Promise<'closed' | 'timedOut' | 'cancelled'>((resolve) => {
    settleClose = resolve;
  });
  const closeListener = () => settleClose?.('closed');
  electronApp.once('close', closeListener);
  const closeTimeout = setTimeout(
    () => settleClose?.('timedOut'),
    ELECTRON_E2E_GRACEFUL_EXIT_SAFETY_TIMEOUT_MILLISECONDS,
  );

  try {
    try {
      await mainWindow.evaluate((window) => window.close());
    } catch (error) {
      if (!page.isClosed()) throw error;
    }
    expect(await applicationClosed).toBe('closed');
  } finally {
    clearTimeout(closeTimeout);
    electronApp.off('close', closeListener);
    settleClose?.('cancelled');
    await applicationClosed;
  }

  const events = readElectronOperationalEvents(
    join(runtime.userDataPath, 'runtime', 'logs'),
  ).filter((event) => event.runtimeInstanceId === runtime.runtimeInstanceId);
  expect(events.filter((event) => event.eventName === 'desktop.started')).toHaveLength(1);
  expect(events.filter((event) => event.eventName === 'desktop.shutdownFailed')).toEqual([]);
  expect(events.filter((event) => event.eventName === 'desktop.shutdownCompleted')).toHaveLength(1);
});
