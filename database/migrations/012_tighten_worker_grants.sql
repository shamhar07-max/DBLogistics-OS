-- 012 Least privilege: the worker may advance delivery bookkeeping, never rewrite event/inbox payloads.
REVOKE UPDATE ON platform.outbox FROM dbl_worker;
GRANT UPDATE (published_at, attempts, last_error) ON platform.outbox TO dbl_worker;
REVOKE UPDATE ON integ.inbox_events FROM dbl_worker;
GRANT UPDATE (status, processed_at, error) ON integ.inbox_events TO dbl_worker;
