import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { HTTP_STATUS, type ErrorCode } from '@dbl/contracts';

export class DomainError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: Record<string, unknown>) { super(message); }
}
const CHECK_MAP: Record<string, [ErrorCode, string]> = {
  stock_non_negative: ['INSUFFICIENT_STOCK', 'Quantity cannot go below zero.'],
  stock_reserved_le_on_hand: ['INSUFFICIENT_STOCK', 'Reserved quantity cannot exceed quantity on hand.'],
  payment_allocation_bounds: ['OVER_ALLOCATION', 'Allocation exceeds the available payment amount.'],
  invoice_allocation_bounds: ['OVER_ALLOCATION', 'Allocation exceeds the invoice total.'],
};
/** Translate PostgreSQL integrity errors into stable API errors. */
export function mapPgError(e: any): unknown {
  if (!e || typeof e !== 'object' || !('code' in e) || typeof e.code !== 'string') return e;
  switch (e.code) {
    case '23505': return new DomainError('DUPLICATE', 'A record with the same unique key already exists.', { constraint: e.constraint });
    case '23514': { const m = CHECK_MAP[e.constraint]; return m ? new DomainError(m[0], m[1], { constraint: e.constraint }) : new DomainError('VALIDATION_FAILED', `Constraint violated: ${e.constraint}`, { constraint: e.constraint }); }
    case '23503': return new DomainError('VALIDATION_FAILED', 'Referenced record does not exist for this tenant.', { constraint: e.constraint });
    case '23000': return new DomainError('INVALID_STATE_TRANSITION', e.message);
    case '42501': return new DomainError('FORBIDDEN', 'Operation blocked by tenant isolation policy.');
    default: return e;
  }
}
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(ex: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse(); const req = host.switchToHttp().getRequest();
    const requestId = req.requestId ?? 'req_unknown';
    let code: ErrorCode = 'INTERNAL', message = 'Unexpected error.', details: Record<string, unknown> | undefined;
    if (ex instanceof DomainError) { code = ex.code; message = ex.message; details = ex.details; }
    else if (ex instanceof HttpException) { const s = ex.getStatus(); code = s === 503 ? 'SERVICE_UNAVAILABLE' : s === 404 ? 'NOT_FOUND' : s === 401 ? 'UNAUTHENTICATED' : s === 403 ? 'FORBIDDEN' : 'VALIDATION_FAILED'; message = ex.message; }
    else console.error(`[${requestId}]`, ex);
    res.status(HTTP_STATUS[code]).json({ code, message, requestId, ...(details ? { details } : {}) });
  }
}
