'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { BodyOf, OperationId, ParamsOf } from '@dbl/contracts';
import { ApiError, call } from './api';

export function useOp<Id extends OperationId>(op: Id, args?: { params?: ParamsOf<Id>; query?: Record<string, unknown>; enabled?: boolean }) {
  return useQuery({ queryKey: [op, args?.params ?? null, args?.query ?? null], queryFn: () => call(op, args as any), enabled: args?.enabled ?? true });
}
export function useCmd<Id extends OperationId>(op: Id, o: { invalidate?: OperationId[]; onSuccess?: (d: any) => void } = {}) {
  const qc = useQueryClient();
  return useMutation<any, ApiError, { params?: ParamsOf<Id>; body?: BodyOf<Id>; ifMatch?: number }>({
    mutationFn: (v) => call(op, v as any),
    onSuccess: (d) => { o.invalidate?.forEach((k) => qc.invalidateQueries({ queryKey: [k] })); o.onSuccess?.(d); },
  });
}
export const errView = (e: unknown) => (e instanceof ApiError ? { status: e.status, code: e.code, message: e.message } : e ? { message: String(e) } : null);
export const money = (v: string | number | null | undefined, cur = 'AED') => (v == null ? '—' : new Intl.NumberFormat('en-AE', { style: 'currency', currency: cur }).format(Number(v)));
