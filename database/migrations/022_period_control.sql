ALTER TABLE finance.accounting_periods ADD CONSTRAINT period_tenant_identity UNIQUE(tenant_id,id);
ALTER TABLE finance.accounting_periods ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE finance.accounting_periods ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER accounting_period_version BEFORE UPDATE ON finance.accounting_periods FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE finance.period_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,period_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('close','reopen')),reason text NOT NULL,requested_by uuid NOT NULL,requested_at timestamptz NOT NULL DEFAULT now(),snapshot jsonb NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),decided_by uuid,decided_at timestamptz,decision_note text,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,period_id) REFERENCES finance.accounting_periods(tenant_id,id),FOREIGN KEY(tenant_id,requested_by) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,decided_by) REFERENCES platform.memberships(tenant_id,id),CHECK(decided_by IS NULL OR decided_by<>requested_by),CHECK((status='pending')=(decided_by IS NULL))
);
CREATE UNIQUE INDEX one_pending_period_request ON finance.period_requests(tenant_id,period_id) WHERE status='pending';
CREATE FUNCTION finance.guard_period_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status<>'pending' OR NEW.status='pending' OR(NEW.tenant_id,NEW.period_id,NEW.kind,NEW.reason,NEW.requested_by,NEW.snapshot) IS DISTINCT FROM(OLD.tenant_id,OLD.period_id,OLD.kind,OLD.reason,OLD.requested_by,OLD.snapshot) THEN RAISE EXCEPTION 'period request is immutable except for an independent decision' USING ERRCODE='23000';END IF;RETURN NEW;
END $$;
CREATE TRIGGER period_request_guard BEFORE UPDATE ON finance.period_requests FOR EACH ROW EXECUTE FUNCTION finance.guard_period_request();
SELECT platform.enforce_rls('finance','period_requests');GRANT SELECT,INSERT,UPDATE ON finance.period_requests TO dbl_app;
-- Serialize every journal insert with period closing, including direct runtime SQL.
CREATE FUNCTION finance.guard_journal_period() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE state text;
BEGIN
 SELECT status INTO state FROM finance.accounting_periods WHERE tenant_id=NEW.tenant_id AND legal_entity_id=NEW.legal_entity_id AND NEW.posting_date BETWEEN start_date AND end_date FOR SHARE;
 IF state IS DISTINCT FROM 'open' THEN RAISE EXCEPTION 'posting requires an open accounting period' USING ERRCODE='23000';END IF;RETURN NEW;
END $$;
CREATE TRIGGER journal_period_guard BEFORE INSERT ON finance.journals FOR EACH ROW EXECUTE FUNCTION finance.guard_journal_period();
-- Upgrade existing role templates under the schema owner, within the migration transaction.
ALTER TABLE platform.roles NO FORCE ROW LEVEL SECURITY;ALTER TABLE platform.role_permissions NO FORCE ROW LEVEL SECURITY;
INSERT INTO platform.role_permissions(tenant_id,role_id,permission) SELECT tenant_id,id,p FROM platform.roles CROSS JOIN unnest(ARRAY['finance.period.view','finance.period.request','finance.period.decide']) p WHERE key='owner' ON CONFLICT DO NOTHING;
INSERT INTO platform.role_permissions(tenant_id,role_id,permission) SELECT tenant_id,id,p FROM platform.roles CROSS JOIN unnest(ARRAY['finance.period.view','finance.period.request']) p WHERE key IN ('accountant','finance_manager') ON CONFLICT DO NOTHING;
INSERT INTO platform.role_permissions(tenant_id,role_id,permission) SELECT tenant_id,id,'finance.period.decide' FROM platform.roles WHERE key='finance_manager' ON CONFLICT DO NOTHING;
INSERT INTO platform.role_permissions(tenant_id,role_id,permission) SELECT tenant_id,id,'finance.period.view' FROM platform.roles WHERE key='auditor' ON CONFLICT DO NOTHING;
ALTER TABLE platform.roles FORCE ROW LEVEL SECURITY;ALTER TABLE platform.role_permissions FORCE ROW LEVEL SECURITY;
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE finance.accounting_periods ADD CONSTRAINT accounting_periods_no_overlap EXCLUDE USING gist(tenant_id WITH =,legal_entity_id WITH =,daterange(start_date,end_date,'[]') WITH &&);
-- A posted journal cannot acquire new lines in a later transaction.
CREATE FUNCTION finance.guard_journal_line_insert() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM finance.journals j WHERE j.tenant_id=NEW.tenant_id AND j.id=NEW.journal_id AND j.xmin::text=(txid_current()%4294967296)::text) THEN RAISE EXCEPTION 'journal lines must be committed with their new journal' USING ERRCODE='23000';END IF;RETURN NEW;
END $$;
CREATE TRIGGER journal_line_insert_guard BEFORE INSERT ON finance.journal_lines FOR EACH ROW EXECUTE FUNCTION finance.guard_journal_line_insert();
CREATE FUNCTION finance.guard_period_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF current_user='dbl_app' THEN
  IF(NEW.tenant_id,NEW.legal_entity_id,NEW.start_date,NEW.end_date) IS DISTINCT FROM(OLD.tenant_id,OLD.legal_entity_id,OLD.start_date,OLD.end_date) THEN RAISE EXCEPTION 'accounting period definition is immutable' USING ERRCODE='23000';END IF;
  IF NEW.status<>OLD.status AND NOT EXISTS(SELECT 1 FROM finance.period_requests r WHERE r.tenant_id=NEW.tenant_id AND r.period_id=NEW.id AND r.status='approved' AND r.kind=CASE WHEN NEW.status='closed' THEN 'close' ELSE 'reopen' END AND r.xmin::text=(txid_current()%4294967296)::text) THEN RAISE EXCEPTION 'period status requires an approved independent request' USING ERRCODE='23000';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER accounting_period_guard BEFORE UPDATE ON finance.accounting_periods FOR EACH ROW EXECUTE FUNCTION finance.guard_period_change();
