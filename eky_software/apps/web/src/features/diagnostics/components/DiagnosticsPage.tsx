import type { EkyApiClient } from '@eky/api-client';

import { DiagnosticsPageView } from './DiagnosticsPageView.js';
import { useDiagnostics } from '../hooks/useDiagnostics.js';

interface DiagnosticsPageProps {
  apiClient: Pick<EkyApiClient, 'listDiagnosticEvents'>;
}

export function DiagnosticsPage({
  apiClient,
}: DiagnosticsPageProps): React.JSX.Element {
  return <DiagnosticsPageView {...useDiagnostics(apiClient)} />;
}

