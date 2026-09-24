import { app, type BrowserWindow } from 'electron';

import {
  createFirstStartLoadProbe,
  firstStartLoadSlots,
  type FirstStartLoadPhase,
  type FirstStartLoadSlot,
  type FirstStartLoadSnapshot,
} from './workspaceFirstStartLoadObservation.js';

export type FirstStartLoadExperimentMode = 'observe' | 'releaseAfterProtocolRemoval';

// Own only windows created during this proof's composition call. No global
// prototype or production dependency surface is changed for this experiment.
export class WorkspaceFirstStartLoadExperiment {
  private readonly captures = new Map<FirstStartLoadSlot, ReturnType<typeof captureCompositionWindow>>();

  constructor(
    private readonly mode: FirstStartLoadExperimentMode,
    private readonly observe: (phase: FirstStartLoadPhase) => void,
  ) {}

  startComposition(slot: FirstStartLoadSlot) {
    if (this.captures.has(slot)) throw new Error('E2E_FIRST_START_LOAD_SLOT_REUSED');
    const forced = this.mode === 'releaseAfterProtocolRemoval' && slot === 'mixedInitial';
    const capture = captureCompositionWindow(forced, (event) => this.observe(`${slot}:${event}`));
    this.captures.set(slot, capture);
    return capture;
  }

  shutdownStarted(window: BrowserWindow): void {
    this.forWindow(window).probe.shutdownStarted();
  }

  waitForLoadBeforeShutdown(window: BrowserWindow): Promise<void> {
    return this.forWindow(window).probe.waitForLoadBeforeShutdown();
  }

  cancelPending(window: BrowserWindow): void {
    this.forWindow(window).probe.dispose();
  }

  protocolRemoved(window: BrowserWindow, removed: boolean, absent: boolean): Promise<void> | undefined {
    const capture = this.forWindow(window);
    capture.probe.protocolRemoved(removed, absent);
    if (!capture.forced) return undefined;
    if (!removed || !absent) throw new Error('E2E_FIRST_START_LOAD_REMOVAL_UNVERIFIED');
    // Only the forced experiment waits here, preventing another composition
    // from re-registering the protocol before the actual navigation finishes.
    return capture.probe.forcedOutcome.then(() => capture.probe.assertComplete());
  }

  assertComplete(): void {
    if (this.captures.size !== firstStartLoadSlots.length) {
      throw new Error('E2E_FIRST_START_LOAD_COMPOSITIONS_INCOMPLETE');
    }
    for (const slot of firstStartLoadSlots) this.captures.get(slot)!.probe.assertComplete();
  }

  snapshot(): readonly FirstStartLoadSnapshot[] {
    return firstStartLoadSlots.map((slot) => {
      const capture = this.captures.get(slot);
      if (capture === undefined) throw new Error('E2E_FIRST_START_LOAD_COMPOSITIONS_INCOMPLETE');
      return capture.probe.snapshot();
    });
  }

  dispose(): void {
    let failed = false;
    for (const capture of this.captures.values()) {
      try { capture.dispose(); } catch { failed = true; }
    }
    if (failed) throw new Error('E2E_FIRST_START_LOAD_HOOK_CLEANUP_FAILED');
  }

  private forWindow(window: BrowserWindow) {
    for (const capture of this.captures.values()) {
      if (capture.owns(window)) return capture;
    }
    throw new Error('E2E_FIRST_START_LOAD_WINDOW_UNOWNED');
  }
}

function captureCompositionWindow(
  forced: boolean,
  observe: Parameters<typeof createFirstStartLoadProbe>[0]['observe'],
) {
  const probe = createFirstStartLoadProbe({ holdUntilProtocolRemoval: forced, observe });
  let owned: BrowserWindow | undefined;
  let windows = 0;
  let attachmentFailed = false;
  let restore: (() => void) | undefined;
  const onCreated = (_event: Electron.Event, window: BrowserWindow) => {
    windows++;
    if (windows !== 1) return;
    owned = window;
    try {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'loadURL');
      const original = window.loadURL;
      const wrapped = probe.wrapLoad((...args: Parameters<BrowserWindow['loadURL']>) =>
        original.apply(window, args),
      );
      const onFailed = (_loadEvent: Electron.Event, _code: number, _description: string, _url: string, isMainFrame: boolean) => {
        if (isMainFrame) probe.mainFrameFailed();
      };
      window.loadURL = wrapped;
      restore = () => {
        window.webContents.removeListener('did-fail-load', onFailed);
        if (window.loadURL !== wrapped) throw new Error('E2E_FIRST_START_LOAD_HOOK_OWNERSHIP_LOST');
        if (descriptor === undefined) {
          if (!Reflect.deleteProperty(window, 'loadURL')) throw new Error('E2E_FIRST_START_LOAD_HOOK_RESTORE_FAILED');
        }
        else Object.defineProperty(window, 'loadURL', descriptor);
      };
      window.webContents.on('did-fail-load', onFailed);
      probe.observe('windowObserved');
    } catch { attachmentFailed = true; }
  };
  app.on('browser-window-created', onCreated);
  return {
    forced,
    probe,
    owns: (window: BrowserWindow) => owned === window,
    acceptWindow(window: BrowserWindow) {
      if (windows !== 1 || owned !== window || attachmentFailed) {
        throw new Error('E2E_FIRST_START_LOAD_WINDOW_CAPTURE_FAILED');
      }
    },
    stopCreationObservation() { app.removeListener('browser-window-created', onCreated); },
    dispose() {
      app.removeListener('browser-window-created', onCreated);
      try { restore?.(); } finally { probe.dispose(); }
    },
  };
}
