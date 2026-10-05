-- 003 Commercial: enquiries, rates, quotes (immutable once approved), quote lines
CREATE TABLE commercial.enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  ref text NOT NULL, customer_party_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new','qualified','quoted','lost','converted')),
  mode text NOT NULL CHECK (mode IN ('ocean_fcl','ocean_lcl','air','road','multimodal','warehouse','customs')),
  origin text NOT NULL, destination text NOT NULL, incoterm text,
  cargo jsonb NOT NULL DEFAULT '{}', missing_information jsonb NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'staff' CHECK (source IN ('staff','email','whatsapp','portal','api','website')),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TABLE commercial.rate_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  supplier_party_id uuid NOT NULL, lane text NOT NULL, service text NOT NULL, billing_unit text NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount >= 0), currency char(3) NOT NULL REFERENCES ref.currencies(code),
  min_charge numeric(18,4), valid_from date NOT NULL, valid_to date NOT NULL CHECK (valid_to >= valid_from),
  conditions jsonb NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'approved' CHECK (status IN ('draft','approved','expired','superseded')),
  version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), FOREIGN KEY (tenant_id, supplier_party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TABLE commercial.quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  ref text NOT NULL, revision int NOT NULL DEFAULT 1,
  enquiry_id uuid, customer_party_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','sent','accepted','expired','superseded')),
  currency char(3) NOT NULL REFERENCES ref.currencies(code),
  valid_until date NOT NULL,
  mode text NOT NULL, origin text NOT NULL, destination text NOT NULL, incoterm text,
  approved_by uuid, approved_at timestamptz, accepted_by uuid, accepted_at timestamptz, acceptance_evidence jsonb,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref, revision),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id),
  FOREIGN KEY (tenant_id, enquiry_id) REFERENCES commercial.enquiries (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_party_id) REFERENCES parties.parties (tenant_id, id),
  CHECK (status NOT IN ('approved','sent','accepted') OR approved_by IS NOT NULL)
);
CREATE TABLE commercial.quote_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, quote_id uuid NOT NULL,
  seq int NOT NULL, description text NOT NULL,
  charge_type text NOT NULL CHECK (charge_type IN ('fixed','estimated','at_cost','conditional')),
  charge_group text NOT NULL DEFAULT 'main' CHECK (charge_group IN ('origin','main','destination','customs','warehouse','other')),
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0), unit text NOT NULL DEFAULT 'shipment',
  unit_price numeric(18,4) NOT NULL CHECK (unit_price >= 0),
  expected_unit_cost numeric(18,4) NOT NULL DEFAULT 0 CHECK (expected_unit_cost >= 0),
  tax_code text NOT NULL DEFAULT 'SR5' CHECK (tax_code IN ('SR5','ZR','EX','OOS')),
  tax_rationale text,
  supplier_party_id uuid,
  UNIQUE (tenant_id, quote_id, seq),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES commercial.quotes (tenant_id, id) ON DELETE CASCADE
);
-- Accepted/approved quote versions must remain reconstructable: lines are frozen once the quote leaves draft.
CREATE FUNCTION commercial.freeze_quote_lines() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s text; qid uuid := COALESCE(NEW.quote_id, OLD.quote_id);
BEGIN
  SELECT status INTO s FROM commercial.quotes WHERE id = qid;
  IF s IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'quote % is % — lines are immutable; create a new revision', qid, s USING ERRCODE='integrity_constraint_violation'; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER quote_lines_frozen BEFORE INSERT OR UPDATE OR DELETE ON commercial.quote_lines FOR EACH ROW EXECUTE FUNCTION commercial.freeze_quote_lines();
CREATE TRIGGER quotes_version BEFORE UPDATE ON commercial.quotes FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TRIGGER enquiries_version BEFORE UPDATE ON commercial.enquiries FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TRIGGER parties_version BEFORE UPDATE ON parties.parties FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TRIGGER legal_entities_version BEFORE UPDATE ON org.legal_entities FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
