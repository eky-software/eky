import { createWindowsServiceControl, type WindowsServiceControl } from './windowsServiceControl.js';

export type ViteServiceControl = WindowsServiceControl<'vite'>;
const control = createWindowsServiceControl('vite');
export const beforeViteOwnerDeadline = control.beforeWindowsOwnerDeadline;
export const connectViteServiceControl = control.connectWindowsServiceControl;
export const attachViteServiceControl = control.attachWindowsServiceControl;
