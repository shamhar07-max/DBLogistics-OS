-- 013 People & assets, Quality (incidents/claims), conversation log, task completion, trip driver link.
CREATE SCHEMA people; CREATE SCHEMA quality;

CREATE TABLE people.employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id), legal_entity_id uuid NOT NULL,
  full_name text NOT NULL, job_title text, department text, status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  user_id uuid, hired_on date, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id)
);
CREATE TABLE people.qualifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, employee_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('forklift','dg_handling','driving','customs_broker','first_aid','reefer_handling')),
  reference text, issued_on date NOT NULL, valid_to date NOT NULL CHECK (valid_to >= issued_on),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, employee_id) REFERENCES people.employees (tenant_id, id)
);
CREATE INDEX ON people.qualifications (tenant_id, employee_id, kind, valid_to);
CREATE TABLE people.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, facility_id uuid,
  kind text NOT NULL CHECK (kind IN ('forklift','scanner','reefer_unit','vehicle','temperature_logger')), code text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','maintenance','retired')), next_service_due date, calibration_due date,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, code), FOREIGN KEY (tenant_id, facility_id) REFERENCES org.facilities (tenant_id, id)
);
ALTER TABLE transport.trips ADD COLUMN driver_employee_id uuid;
ALTER TABLE transport.trips ADD CONSTRAINT trips_driver_fk FOREIGN KEY (tenant_id, driver_employee_id) REFERENCES people.employees (tenant_id, id);

CREATE TABLE quality.incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, ref text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('damage','shortage','temperature_excursion','delay','document_error','other')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved')),
  description text NOT NULL, job_id uuid, shipment_id uuid, lot_id uuid, hold_id uuid,
  reported_by uuid NOT NULL, resolution_note text, resolved_by uuid, resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, job_id) REFERENCES logistics.jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id),
  FOREIGN KEY (tenant_id, lot_id) REFERENCES warehouse.stock_lots (tenant_id, id),
  CHECK (status <> 'resolved' OR (resolution_note IS NOT NULL AND resolved_by IS NOT NULL))
);
CREATE TRIGGER incidents_version BEFORE UPDATE ON quality.incidents FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE quality.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, incident_id uuid NOT NULL,
  claimant_party_id uuid, insurer_party_id uuid, amount numeric(18,4) NOT NULL CHECK (amount > 0), currency char(3) NOT NULL REFERENCES ref.currencies(code),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','submitted','settled','rejected')), created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, incident_id) REFERENCES quality.incidents (tenant_id, id)
);
-- A hold records who placed and who released it; the releaser must be a different person (maker-checker).
ALTER TABLE warehouse.holds ADD COLUMN release_note text;
ALTER TABLE warehouse.holds ADD CONSTRAINT hold_release_by_other CHECK (released_by IS NULL OR released_by <> placed_by);
ALTER TABLE warehouse.holds ADD CONSTRAINT hold_release_complete CHECK ((released_at IS NULL) = (released_by IS NULL));

ALTER TABLE collab.tasks ADD COLUMN completed_by uuid, ADD COLUMN completed_at timestamptz;
ALTER TABLE collab.tasks ADD CONSTRAINT task_done_complete CHECK (status <> 'done' OR (completed_by IS NOT NULL AND completed_at IS NOT NULL));
CREATE TABLE collab.messages (       -- conversation log: append-only evidence of what was said, to whom, through which channel
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  related_type text NOT NULL, related_id uuid NOT NULL, channel text NOT NULL CHECK (channel IN ('internal','email','whatsapp','call')),
  direction text NOT NULL CHECK (direction IN ('inbound','outbound','internal')), body text NOT NULL, author_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON collab.messages (tenant_id, related_type, related_id, created_at);
CREATE TRIGGER messages_append_only BEFORE UPDATE OR DELETE ON collab.messages FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();

-- Reusable RLS enabler (same policy as 008) so new tables cannot be forgotten.
CREATE FUNCTION platform.enforce_rls(p_schema text, p_table text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', p_schema, p_table);
  EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', p_schema, p_table);
  EXECUTE format($f$CREATE POLICY tenant_isolation ON %I.%I FOR ALL TO dbl_app USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant())$f$, p_schema, p_table);
END $$;
SELECT platform.enforce_rls(s, t) FROM (VALUES ('people','employees'),('people','qualifications'),('people','assets'),('quality','incidents'),('quality','claims'),('collab','messages')) v(s,t);
GRANT USAGE ON SCHEMA people, quality TO dbl_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA people, quality TO dbl_app;
GRANT SELECT, INSERT ON collab.messages TO dbl_app; REVOKE UPDATE, DELETE ON collab.messages FROM dbl_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA collab TO dbl_app;
GRANT UPDATE ON warehouse.holds TO dbl_app;
