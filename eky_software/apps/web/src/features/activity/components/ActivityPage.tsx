import type { EkyApiClient } from '@eky/api-client';

import { ActivityPageView } from './ActivityPageView.js';
import { useActivity } from '../hooks/useActivity.js';

interface ActivityPageProps {
  apiClient: Pick<EkyApiClient, 'listActivity'>;
}

export function ActivityPage({
  apiClient,
}: ActivityPageProps): React.JSX.Element {
  return <ActivityPageView {...useActivity(apiClient)} />;
}
