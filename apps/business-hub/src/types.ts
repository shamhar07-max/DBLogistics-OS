export interface D1Result<T = Record<string, unknown>> { results: T[]; success: boolean; meta?: Record<string, unknown> }
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<D1Result<T>>; run(): Promise<D1Result> }
export interface D1 { prepare(sql: string): D1Stmt; batch(s: D1Stmt[]): Promise<D1Result[]> }
export interface Env { DB: D1; LOGISTICS_OS_URL?: string; PORTAL_URL?: string; BRAND_ORIGIN?: string }
export interface Session { userId: string; tenantId: string; role: string; name: string; email: string; mustChange: boolean; company: string; sessionHash: string }
