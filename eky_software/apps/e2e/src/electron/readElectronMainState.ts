import type { ElectronApplication } from '@playwright/test';

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
