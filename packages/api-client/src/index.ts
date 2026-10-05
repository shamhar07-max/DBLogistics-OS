import { ROUTE_BY_ID, type ApiErrorBody, type BodyOf, type OperationId, type ParamsOf } from '@dbl/contracts';

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) { super(body.message); }
  get code() { return this.body.code; }
}
export interface ClientOptions { baseUrl: string; tenantId?: string; getToken?: () => Promise<string | undefined> | string | undefined; fetch?: typeof fetch; credentials?: RequestCredentials; headers?: () => Record<string, string> }
export interface CallOptions { idempotencyKey?: string; ifMatch?: number; query?: Record<string, string | number | undefined>; signal?: AbortSignal }

/** Typed client generated from the contract table: operationId → body/params types. Commands get an Idempotency-Key automatically. */
export function createClient(o: ClientOptions) {
  const f = o.fetch ?? fetch;
  async function call<Id extends OperationId>(op: Id, args: { params?: ParamsOf<Id>; body?: BodyOf<Id> } & CallOptions = {} as any): Promise<any> {
    const route = ROUTE_BY_ID[op]; if (!route) throw new Error(`Unknown operation ${op}`);
    let path = route.path.replace(/:(\w+)/g, (_, k) => encodeURIComponent(((args.params as Record<string, string>) ?? {})[k] ?? ''));
    if (args.query) { const q = Object.entries(args.query).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join('&'); if (q) path += `?${q}`; }
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = await o.getToken?.(); if (token) headers.Authorization = `Bearer ${token}`;
    if (o.tenantId) headers['X-Tenant-Id'] = o.tenantId;
    Object.assign(headers, o.headers?.() ?? {});
    if (route.method === 'POST') headers['Content-Type'] = 'application/json';
    if (route.idempotent) headers['Idempotency-Key'] = args.idempotencyKey ?? crypto.randomUUID();
    if (args.ifMatch !== undefined) headers['If-Match'] = `"${args.ifMatch}"`;
    const res = await f(`${o.baseUrl}/api/v1${path}`, { method: route.method, headers, body: route.method === 'POST' ? JSON.stringify(args.body ?? {}) : undefined, credentials: o.credentials, signal: args.signal });
    const text = await res.text(); const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, json ?? { code: 'INTERNAL', message: res.statusText, requestId: 'n/a' });
    return json;
  }
  return { call };
}
export type Client = ReturnType<typeof createClient>;
