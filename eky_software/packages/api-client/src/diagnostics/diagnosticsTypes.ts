export const diagnosticEventNames = Object.freeze([
  'applicationWindow.loadFailed',
  'applicationWindow.navigationBlocked',
  'applicationWindow.newWindowBlocked',
  'applicationWindow.renderProcessGone',
  'backend.shutdownCompleted',
  'backend.shutdownStarted',
  'backend.started',
  'backend.starting',
  'backendProcess.healthFailed',
  'backendProcess.started',
  'backendProcess.starting',
  'backendProcess.stopFailed',
  'backendProcess.unexpectedExit',
  'businessAudit.retentionCompleted',
  'businessAudit.retentionFailed',
  'businessAudit.writeFailed',
  'database.integrityCheckFailed',
  'database.openFailed',
  'database.opened',
  'database.opening',
  'desktop.shutdownCompleted',
  'desktop.shutdownFailed',
  'desktop.shutdownStarted',
  'desktop.started',
  'desktop.starting',
  'electron.permissionDenied',
  'electron.permissionRequestBlocked',
  'http.invalidBody',
  'http.requestFailed',
  'http.unknownRoute',
  'invoiceDelivery.finalizationFailed',
  'invoiceDelivery.outcomeUnknown',
  'invoiceDelivery.prepareBlocked',
  'invoiceDelivery.providerFailed',
  'invoicePdf.generationFailed',
  'invoicePdf.missingFile',
  'invoicePdf.storageFailed',
  'migration.completed',
  'migration.failed',
  'migration.started',
  'operationalLog.capacityReached',
  'operationalLog.retentionCompleted',
  'operationalLog.writeFailed',
  'operationalLogFolder.opened',
  'operationalLogFolder.openFailed',
  'operationalLogFolder.requestBlocked',
  'packagedSmoke.completed',
  'packagedSmoke.failed',
  'packagedSmoke.started',
  'pdfPreview.openFailed',
  'permission.denied',
  'runtimeSession.invalid',
  'runtimeSession.missing',
  'secretStorage.decryptFailed',
  'secretStorage.writeFailed',
  'smtp.authenticationFailed',
  'smtp.connectionFailed',
  'smtp.deliveryFailed',
  'smtp.deliveryOutcomeUnknown',
  'smtp.tlsFailed',
  'supportBundle.creationCompleted',
  'supportBundle.creationFailed',
  'supportBundle.creationStarted',
  'tenant.boundaryBlocked',
] as const);

export type DiagnosticEventName = (typeof diagnosticEventNames)[number];
export type DiagnosticEventComponent = 'backend' | 'desktop';
export type DiagnosticEventLevel = 'error' | 'info' | 'warn';
export type DiagnosticEventOutcome =
  | 'blocked'
  | 'failure'
  | 'success'
  | 'unknown';

export interface DiagnosticEventItem {
  category: string;
  component: DiagnosticEventComponent;
  errorCode: string | null;
  eventName: DiagnosticEventName;
  id: string;
  level: DiagnosticEventLevel;
  occurredAt: string;
  outcome: DiagnosticEventOutcome;
}

export interface DiagnosticEventListQuery {
  limit?: number;
}

export interface DiagnosticsApi {
  listDiagnosticEvents(
    query?: DiagnosticEventListQuery,
  ): Promise<DiagnosticEventItem[]>;
}
