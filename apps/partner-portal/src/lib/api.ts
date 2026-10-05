'use client';
import { createClient, ApiError } from '@dbl/api-client';
import { QueryClient } from '@tanstack/react-query';
import type { BodyOf, OperationId, ParamsOf } from '@dbl/contracts';

let csrf = '';
export const setCsrf = (c: string) => { csrf = c; };
export const api = createClient({ baseUrl: '/api/proxy', credentials: 'same-origin', headers: (): Record<string, string> => (csrf ? { 'X-CSRF-Token': csrf } : {}) });
export const queryClient = () => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false } } });
/** Typed call helper used by hooks. */
export const call = <Id extends OperationId>(op: Id, a?: { params?: ParamsOf<Id>; body?: BodyOf<Id>; ifMatch?: number; idempotencyKey?: string }) => api.call(op, (a ?? {}) as any);
export { ApiError };
