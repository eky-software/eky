import { createEkyApiClient, type EkyApiClient } from '@eky/api-client';

export interface WebAppComposition {
  apiClient: EkyApiClient;
}

export function createWebAppComposition(): WebAppComposition {
  return {
    apiClient: createEkyApiClient({
      baseUrl: import.meta.env.VITE_EKY_API_BASE_URL ?? '',
    }),
  };
}
