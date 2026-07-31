import {
  EkyApiError,
  type CustomerActivityEntry,
  type EkyApiClient,
} from '@eky/api-client';
import { useEffect, useRef, useState } from 'react';

import { getFinnishApiErrorMessage, uiText } from '../../../i18n/fi.js';

type CustomerActivityClient = Pick<EkyApiClient, 'listCustomerActivity'>;

export interface CustomerActivityState {
  activityEntries: CustomerActivityEntry[];
  errorMessage: string | null;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
  isLoading: boolean;
  page: number;
  goToPage(page: number): void;
}

export function useCustomerActivity(
  apiClient: CustomerActivityClient,
  customerId: string | null,
): CustomerActivityState {
  const [activityEntries, setActivityEntries] = useState<
    CustomerActivityEntry[]
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [hasPreviousPage, setHasPreviousPage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [page, setPage] = useState(1);
  const requestSequence = useRef(0);

  useEffect(() => {
    setPage(1);
  }, [customerId]);

  useEffect(() => {
    if (customerId === null) {
      requestSequence.current += 1;
      setActivityEntries([]);
      setErrorMessage(null);
      setHasNextPage(false);
      setHasPreviousPage(false);
      setIsLoading(false);
      return;
    }

    const activeCustomerId = customerId;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setIsLoading(true);
    setErrorMessage(null);

    async function loadActivity(): Promise<void> {
      try {
        const activityPage = await apiClient.listCustomerActivity(
          activeCustomerId,
          {
            page,
            pageSize: 20,
          },
        );

        if (requestSequence.current !== requestId) {
          return;
        }

        setActivityEntries(activityPage.activityEntries);
        setHasNextPage(activityPage.hasNextPage);
        setHasPreviousPage(activityPage.hasPreviousPage);
      } catch (error) {
        if (requestSequence.current !== requestId) {
          return;
        }

        setActivityEntries([]);
        setHasNextPage(false);
        setHasPreviousPage(false);
        setErrorMessage(getCustomerActivityErrorMessage(error));
      } finally {
        if (requestSequence.current === requestId) {
          setIsLoading(false);
        }
      }
    }

    void loadActivity();

    return () => {
      requestSequence.current += 1;
    };
  }, [apiClient, customerId, page]);

  return {
    activityEntries,
    errorMessage,
    hasNextPage,
    hasPreviousPage,
    isLoading,
    page,
    goToPage(nextPage) {
      if (Number.isSafeInteger(nextPage) && nextPage >= 1) {
        setPage(nextPage);
      }
    },
  };
}

function getCustomerActivityErrorMessage(error: unknown): string {
  if (error instanceof EkyApiError) {
    const translatedMessage = getFinnishApiErrorMessage(error.message);

    if (translatedMessage !== error.message) {
      return translatedMessage;
    }
  }

  return uiText.customers.activityLoadError;
}
