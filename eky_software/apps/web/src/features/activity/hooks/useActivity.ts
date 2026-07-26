import {
  EkyApiError,
  type ActivityItem,
  type ActivityListQuery,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ActivityClient = Pick<EkyApiClient, 'listActivity'>;

export interface ActivityState {
  errorMessage: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isLoading: boolean;
  items: ActivityItem[];
}

export function useActivity(
  apiClient: ActivityClient,
  query: ActivityListQuery,
): ActivityState {
  const [state, setState] = useState<ActivityState>({
    errorMessage: null,
    hasNextPage: false,
    hasPreviousPage: false,
    isLoading: true,
    items: [],
  });

  useEffect(() => {
    let isCurrent = true;
    setState({
      errorMessage: null,
      hasNextPage: false,
      hasPreviousPage: false,
      isLoading: true,
      items: [],
    });

    void apiClient
      .listActivity(query)
      .then((page) => {
        if (isCurrent) {
          setState({
            errorMessage: null,
            hasNextPage: page.hasNextPage,
            hasPreviousPage: page.hasPreviousPage,
            isLoading: false,
            items: page.activityItems,
          });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setState({
            errorMessage: getActivityErrorMessage(error),
            hasNextPage: false,
            hasPreviousPage: false,
            isLoading: false,
            items: [],
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [apiClient, query]);

  return state;
}

export function getActivityErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translated = getFinnishApiErrorMessage(error.message);
    return translated === error.message ? uiText.activity.loadError : translated;
  }
  return uiText.activity.loadError;
}
