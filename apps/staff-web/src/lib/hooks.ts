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
export { errView, money } from '@dbl/ui';
