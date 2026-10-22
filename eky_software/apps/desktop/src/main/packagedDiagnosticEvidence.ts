import {
  readSupportBundleBackendData,
  type SupportBundleBackendData,
} from '../supportBundle/supportBundleBackendData.js';

export function validatePackagedDiagnosticEvidence(value: unknown): void {
  const data = readSupportBundleBackendData(value);
  const events = data.diagnosticEvents;
  const requiredNames = [
    'invoicePdfArchive.queueFailed', 'invoicePdfArchive.copyFailed',
    'update.packageInspectionFailed', 'update.businessRollbackSucceeded',
    'workspaceManagement.operationFailed',
  ];
  if (events.some(event => event.level === 'info') ||
    requiredNames.some(name => !events.some(event => event.eventName === name)) ||
    !events.some(event => event.eventName === 'workspaceManagement.operationFailed' &&
      event.errorCode === 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH' &&
      event.operationId === 'workspace.replace' && event.stage === 'lineageCheck' &&
      event.sideEffectState === 'none') ||
    !data.incidentSummaries.some(incident =>
      incident.eventName === 'workspaceManagement.operationFailed' &&
      incident.errorCode === 'WORKSPACE_REPLACEMENT_LINEAGE_MISMATCH') ||
    data.incidentSummaries.some(incident => isGEvent(incident.eventName) &&
      !matchesDetailedIncident(incident, data))) {
    throw new Error('DESKTOP_SMOKE_SUPPORT_BUNDLE_G_EVIDENCE_FAILED');
  }
}

function isGEvent(name: string): boolean {
  return name.startsWith('invoicePdfArchive.') || name.startsWith('update.') ||
    name.startsWith('workspaceManagement.');
}

function matchesDetailedIncident(
  incident: SupportBundleBackendData['incidentSummaries'][number],
  data: SupportBundleBackendData,
): boolean {
  return data.diagnosticEvents.some(event =>
    event.level === 'error' && event.eventName === incident.eventName &&
    event.errorCode === incident.errorCode && event.outcome === incident.outcome &&
    event.appVersion === incident.appVersion && event.buildRevision === incident.buildRevision &&
    incident.fingerprint === `${event.eventName}:${event.errorCode}`);
}
