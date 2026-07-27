import type {
  ActivityCategory,
  ActivityListQuery,
  ActivityOutcomeFilter,
  EkyApiClient,
} from '@eky/api-client';
import { useMemo, useState } from 'react';

import { ActivityPageView } from './ActivityPageView.js';
import { useActivity } from '../hooks/useActivity.js';

interface ActivityPageProps {
  apiClient: Pick<EkyApiClient, 'listActivity'>;
}

export interface ActivityViewQuery {
  category: ActivityCategory;
  month: string;
  outcome: ActivityOutcomeFilter;
  page: number;
  pageSize: 20 | 50 | 100;
}

export function ActivityPage({
  apiClient,
}: ActivityPageProps): React.JSX.Element {
  const [query, setQuery] = useState<ActivityViewQuery>(() => ({
    category: 'all',
    month: getCurrentMonth(),
    outcome: 'all',
    page: 1,
    pageSize: 20,
  }));
  const apiQuery = useMemo<ActivityListQuery>(() => query, [query]);
  const activity = useActivity(apiClient, apiQuery);

  return (
    <ActivityPageView
      {...activity}
      query={query}
      onCategoryChange={(category) => {
        setQuery((current) => ({ ...current, category, page: 1 }));
      }}
      onMonthChange={(month) => {
        setQuery((current) => ({ ...current, month, page: 1 }));
      }}
      onNextPage={() => {
        setQuery((current) => ({ ...current, page: current.page + 1 }));
      }}
      onOutcomeChange={(outcome) => {
        setQuery((current) => ({ ...current, outcome, page: 1 }));
      }}
      onPageSizeChange={(pageSize) => {
        setQuery((current) => ({ ...current, page: 1, pageSize }));
      }}
      onPreviousPage={() => {
        setQuery((current) => ({
          ...current,
          page: Math.max(1, current.page - 1),
        }));
      }}
    />
  );
}

function getCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
