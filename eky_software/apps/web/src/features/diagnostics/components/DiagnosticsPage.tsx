import type { EkyApiClient } from '@eky/api-client';

import type {
  CreateSupportBundle,
  OpenOperationalLogFolder,
} from '../../../app/desktopBridge.js';
import { DiagnosticsPageView } from './DiagnosticsPageView.js';
import { useDiagnostics } from '../hooks/useDiagnostics.js';

interface DiagnosticsPageProps {
  apiClient: Pick<
    EkyApiClient,
    'getDiagnosticSummary' | 'listDiagnosticEvents'
  >;
  createSupportBundle?: CreateSupportBundle;
  openOperationalLogFolder?: OpenOperationalLogFolder;
}

export function DiagnosticsPage({
  apiClient,
  createSupportBundle,
  openOperationalLogFolder,
}: DiagnosticsPageProps): React.JSX.Element {
  return (
    <DiagnosticsPageView
      {...useDiagnostics(apiClient)}
      {...(createSupportBundle === undefined
        ? {}
        : { createSupportBundle })}
      {...(openOperationalLogFolder === undefined
        ? {}
        : { openOperationalLogFolder })}
    />
  );
}
