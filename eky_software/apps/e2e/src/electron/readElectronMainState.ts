import type { ElectronApplication } from '@playwright/test';
import { selectorCreateScenarioId } from '../../../desktop/e2e/electronSelectorTestRelease.js';

export interface ElectronMainState {
  backendIsRunning: boolean;
  backendStartCount: number;
  runtimeInstanceId: string;
  scenarioId: string;
  secondInstanceCount: number;
  userDataPath: string;
  windowCount: number;
}

export function readElectronMainState(
  electronApp: ElectronApplication,
): Promise<ElectronMainState> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: {
          backendIsRunning(): boolean;
          backendStartCount(): number;
          runtimeInstanceId: string;
          scenarioId: string;
          secondInstanceCount(): number;
          userDataPath: string;
          windowCount(): number;
        };
      }
    ).__EKY_ELECTRON_E2E__;
    if (controller === undefined) {
      throw new Error('Electron E2E controller is unavailable.');
    }
    return {
      backendIsRunning: controller.backendIsRunning(),
      backendStartCount: controller.backendStartCount(),
      runtimeInstanceId: controller.runtimeInstanceId,
      scenarioId: controller.scenarioId,
      secondInstanceCount: controller.secondInstanceCount(),
      userDataPath: controller.userDataPath,
      windowCount: controller.windowCount(),
    };
  });
}

export function readElectronStartupObservation(
  electronApp: ElectronApplication,
): Promise<unknown> {
  return electronApp.evaluate(() => {
    const controller = (
      globalThis as typeof globalThis & {
        __EKY_ELECTRON_E2E__?: { startupObservation(): unknown };
      }
    ).__EKY_ELECTRON_E2E__;
    return controller?.startupObservation();
  });
}

export async function readSelectorTestBackendPort(electronApp: ElectronApplication): Promise<number | undefined> {
  const observed = await electronApp.evaluate(() => {
    const controller = (globalThis as unknown as { __EKY_ELECTRON_E2E__: {
      scenarioId: string; backendIsRunning(): boolean; backendStartCount(): number;
      selectorBackendPort(): number | undefined;
    } }).__EKY_ELECTRON_E2E__;
    return { scenarioId: controller.scenarioId, running: controller.backendIsRunning(),
      starts: controller.backendStartCount(), port: controller.selectorBackendPort() };
  });
  if (observed.scenarioId === selectorCreateScenarioId) {
    if (observed.starts === 0 && observed.running === false && observed.port === undefined) return undefined;
    if (observed.starts === 1 && observed.running === true && Number.isInteger(observed.port)
      && observed.port! > 0 && observed.port! <= 65535) return observed.port;
  }
  throw new Error('E2E_SELECTOR_BACKEND_PORT_UNVERIFIED');
}
