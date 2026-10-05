-- 016 The outbound queue is trusted infrastructure state (like platform.outbox / integ.inbox_events): the worker discovers due rows across tenants,
--     then performs every domain read inside a tenant context. Also: claim timestamp for crash recovery, and the issuer profile for message footers.
DROP POLICY worker_scoped ON integ.outbound_messages;
CREATE POLICY worker_outbound ON integ.outbound_messages FOR ALL TO dbl_worker USING (true) WITH CHECK (true);
ALTER TABLE integ.outbound_messages ADD COLUMN claimed_at timestamptz;
CREATE POLICY worker_scoped ON org.legal_entities FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
GRANT USAGE ON SCHEMA org TO dbl_worker; GRANT SELECT ON org.legal_entities TO dbl_worker;
