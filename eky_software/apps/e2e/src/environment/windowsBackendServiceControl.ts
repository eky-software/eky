import { createWindowsServiceControl, type WindowsServiceControl } from './windowsServiceControl.js';

export type BackendServiceControl = WindowsServiceControl<'backend'>;
const control = createWindowsServiceControl('backend');
export const beforeBackendOwnerDeadline = control.beforeWindowsOwnerDeadline;
export const connectBackendServiceControl = control.connectWindowsServiceControl;
export const attachBackendServiceControl = control.attachWindowsServiceControl;
