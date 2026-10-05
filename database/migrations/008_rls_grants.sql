-- 008 Row-level security, grants. Generated from catalog so no tenant table can be forgotten.
-- (A test asserts every table with tenant_id has FORCE ROW LEVEL SECURITY.)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.table_schema s, c.table_name t FROM information_schema.columns c
    JOIN information_schema.tables tb ON tb.table_schema=c.table_schema AND tb.table_name=c.table_name AND tb.table_type='BASE TABLE'
    WHERE c.column_name = 'tenant_id' AND c.table_schema IN ('platform','org','parties','commercial','logistics','transport','warehouse','trade','finance','collab','automation','integ')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', r.s, r.t);
    EXECUTE format($f$CREATE POLICY tenant_isolation ON %I.%I FOR ALL TO dbl_app
                      USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant())$f$, r.s, r.t);
  END LOOP;
END $$;

-- Tenants: a session sees only its own tenant row.
ALTER TABLE platform.tenants ENABLE ROW LEVEL SECURITY; ALTER TABLE platform.tenants FORCE ROW LEVEL SECURITY;
CREATE POLICY own_tenant ON platform.tenants FOR SELECT TO dbl_app USING (id = platform.current_tenant());
-- Memberships: also visible to the user they belong to (needed to resolve tenant context at login).
CREATE POLICY own_memberships ON platform.memberships FOR SELECT TO dbl_app USING (user_id = platform.current_user_id());
-- Worker role: may read/advance the outbox and inbox across tenants — and nothing else.
CREATE POLICY worker_outbox ON platform.outbox FOR ALL TO dbl_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_tenants ON platform.tenants FOR SELECT TO dbl_worker USING (true);
CREATE POLICY worker_inbox ON integ.inbox_events FOR ALL TO dbl_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_runs ON automation.workflow_runs FOR ALL TO dbl_worker USING (true) WITH CHECK (true);
CREATE POLICY worker_defs ON automation.workflow_definitions FOR SELECT TO dbl_worker USING (true);
CREATE POLICY worker_tasks ON collab.tasks FOR INSERT TO dbl_worker WITH CHECK (true);
CREATE POLICY worker_audit ON platform.audit_events FOR INSERT TO dbl_worker WITH CHECK (true);

-- Grants (least privilege)
GRANT USAGE ON SCHEMA platform,org,parties,commercial,logistics,transport,warehouse,trade,finance,collab,automation,integ,ref TO dbl_app, dbl_worker;
GRANT SELECT ON ALL TABLES IN SCHEMA ref TO dbl_app, dbl_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA org,parties,commercial,logistics,transport,collab,integ,automation TO dbl_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA platform TO dbl_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA warehouse,trade,finance TO dbl_app;
GRANT DELETE ON warehouse.holds TO dbl_app;
-- Append-only tables: no UPDATE / DELETE privilege at all (triggers are the second line of defence)
REVOKE UPDATE, DELETE ON platform.audit_events, warehouse.custody_movements, finance.journals, finance.journal_lines FROM dbl_app;
REVOKE DELETE ON platform.tenants FROM dbl_app;
GRANT SELECT ON platform.tenants TO dbl_app, dbl_worker;
GRANT INSERT ON platform.tenants TO dbl_app;   -- tenant provisioning is performed by platform-admin via the same API role + RLS bypass-free policy below
GRANT SELECT, UPDATE ON platform.outbox, integ.inbox_events, automation.workflow_runs TO dbl_worker;
GRANT INSERT, UPDATE ON automation.workflow_runs TO dbl_worker;
GRANT SELECT ON automation.workflow_definitions TO dbl_worker;
GRANT INSERT ON collab.tasks, platform.audit_events TO dbl_worker;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA platform,finance,warehouse TO dbl_app, dbl_worker;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA platform TO dbl_app, dbl_worker;
-- Provisioning policy: platform-admin API sets app.provisioning='on' only inside the provisioning use case.
CREATE POLICY provision_tenant ON platform.tenants FOR INSERT TO dbl_app WITH CHECK (current_setting('app.provisioning', true) = 'on');
