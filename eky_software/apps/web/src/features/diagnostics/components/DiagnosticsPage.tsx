import type { EkyApiClient } from '@eky/api-client';

import type { OpenOperationalLogFolder } from '../../../app/desktopBridge.js';
import { DiagnosticsPageView } from './DiagnosticsPageView.js';
import { useDiagnostics } from '../hooks/useDiagnostics.js';

interface DiagnosticsPageProps {
  apiClient: Pick<EkyApiClient, 'listDiagnosticEvents'>;
  openOperationalLogFolder?: OpenOperationalLogFolder;
}

export function DiagnosticsPage({
  apiClient,
  openOperationalLogFolder,
}: DiagnosticsPageProps): React.JSX.Element {
  return (
    <DiagnosticsPageView
      {...useDiagnostics(apiClient)}
      {...(openOperationalLogFolder === undefined
        ? {}
        : { openOperationalLogFolder })}
    />
  );
}
