import {
  EkyApiError,
  type ActivityItem,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type ActivityClient = Pick<EkyApiClient, 'listActivity'>;

export interface ActivityState {
  errorMessage: string | null;
  isLoading: boolean;
  items: ActivityItem[];
}

export function useActivity(apiClient: ActivityClient): ActivityState {
  const [state, setState] = useState<ActivityState>({
    errorMessage: null,
    isLoading: true,
    items: [],
  });

  useEffect(() => {
    let isCurrent = true;
    setState({ errorMessage: null, isLoading: true, items: [] });

    void apiClient
      .listActivity()
      .then((items) => {
        if (isCurrent) {
          setState({ errorMessage: null, isLoading: false, items });
        }
      })
      .catch((error: unknown) => {
        if (isCurrent) {
          setState({
            errorMessage: getActivityErrorMessage(error),
            isLoading: false,
            items: [],
          });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [apiClient]);

  return state;
}

export function getActivityErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translated = getFinnishApiErrorMessage(error.message);
    return translated === error.message ? uiText.activity.loadError : translated;
  }
  return uiText.activity.loadError;
}
