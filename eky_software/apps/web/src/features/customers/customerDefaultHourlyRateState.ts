export type CustomerDefaultHourlyRateState =
  | { status: 'loading' }
  | { status: 'loaded'; valueCents: number | null }
  | { status: 'failed' };
