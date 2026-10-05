-- 011 Worker support: exactly-once-effect ledger for event consumers + narrowly scoped, TENANT-BOUND worker grants.
CREATE TABLE automation.processed_events (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id), consumer text NOT NULL, event_id bigint NOT NULL, processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, consumer, event_id)
);
ALTER TABLE automation.processed_events ENABLE ROW LEVEL SECURITY; ALTER TABLE automation.processed_events FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON automation.processed_events FOR ALL TO dbl_app USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON automation.processed_events FOR ALL TO dbl_worker USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
GRANT SELECT ON automation.processed_events TO dbl_app; GRANT SELECT, INSERT ON automation.processed_events TO dbl_worker;

-- Worker touches domain tables only inside a tenant context (app.tenant_id), never across tenants.
CREATE POLICY worker_scoped ON logistics.tracking_events FOR ALL TO dbl_worker USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON logistics.shipments       FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON platform.document_versions FOR ALL TO dbl_worker USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON collab.tasks FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON platform.audit_events FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
GRANT SELECT, INSERT ON logistics.tracking_events TO dbl_worker;
GRANT SELECT ON logistics.shipments TO dbl_worker;
GRANT SELECT, UPDATE (scan_status, extracted) ON platform.document_versions TO dbl_worker;
GRANT SELECT ON collab.tasks, platform.audit_events TO dbl_worker;
GRANT USAGE ON SCHEMA logistics TO dbl_worker;
GRANT UPDATE (published_at, attempts, last_error) ON platform.outbox TO dbl_worker;
