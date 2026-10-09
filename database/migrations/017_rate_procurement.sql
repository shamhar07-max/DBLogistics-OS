-- Rate procurement: immutable supplier revisions, tenant isolation and independent award.
CREATE TABLE commercial.rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  legal_entity_id uuid NOT NULL, ref text NOT NULL,
  mode text NOT NULL CHECK (mode IN ('ocean_fcl','ocean_lcl','air','road','multimodal','warehouse','customs')),
  origin text NOT NULL, destination text NOT NULL, requirements text NOT NULL,
  currency char(3) NOT NULL REFERENCES ref.currencies(code), response_deadline timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','issued','awarded')),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  issued_at timestamptz, awarded_offer_id uuid, awarded_rate_id uuid,
  awarded_by uuid, awarded_at timestamptz, award_reason text,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities(tenant_id,id),
  FOREIGN KEY (tenant_id, awarded_rate_id) REFERENCES commercial.rate_versions(tenant_id,id),
  CHECK (status = 'draft' OR issued_at IS NOT NULL),
  CHECK ((status = 'awarded') = (awarded_offer_id IS NOT NULL)),
  CHECK (status <> 'awarded' OR (awarded_by IS NOT NULL AND awarded_at IS NOT NULL AND awarded_rate_id IS NOT NULL AND length(trim(award_reason)) >= 10 AND awarded_by <> created_by))
);
CREATE TABLE commercial.rfq_suppliers (
  tenant_id uuid NOT NULL, rfq_id uuid NOT NULL, supplier_party_id uuid NOT NULL,
  PRIMARY KEY (tenant_id, rfq_id, supplier_party_id),
  FOREIGN KEY (tenant_id, rfq_id) REFERENCES commercial.rfqs(tenant_id,id),
  FOREIGN KEY (tenant_id, supplier_party_id) REFERENCES parties.parties(tenant_id,id)
);
CREATE TABLE commercial.rfq_offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, rfq_id uuid NOT NULL,
  supplier_party_id uuid NOT NULL, revision int NOT NULL CHECK (revision > 0),
  freight numeric(18,4) NOT NULL CHECK (freight >= 0), local_charges numeric(18,4) NOT NULL CHECK (local_charges >= 0),
  total numeric(19,4) GENERATED ALWAYS AS (freight + local_charges) STORED,
  transit_days int NOT NULL CHECK (transit_days BETWEEN 0 AND 3650),
  free_days int NOT NULL CHECK (free_days BETWEEN 0 AND 3650), valid_until date NOT NULL,
  terms text NOT NULL CHECK (length(trim(terms)) >= 10),
  created_by uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,rfq_id,id), UNIQUE (tenant_id,rfq_id,supplier_party_id,revision),
  FOREIGN KEY (tenant_id,rfq_id,supplier_party_id) REFERENCES commercial.rfq_suppliers(tenant_id,rfq_id,supplier_party_id)
);
ALTER TABLE commercial.rfqs ADD FOREIGN KEY (tenant_id,id,awarded_offer_id) REFERENCES commercial.rfq_offers(tenant_id,rfq_id,id);
CREATE INDEX ON commercial.rfqs(tenant_id,legal_entity_id,created_at DESC);
CREATE INDEX ON commercial.rfq_offers(tenant_id,rfq_id,supplier_party_id,revision DESC);
CREATE TRIGGER rfqs_version BEFORE UPDATE ON commercial.rfqs FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TRIGGER rfq_offers_immutable BEFORE UPDATE OR DELETE ON commercial.rfq_offers FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE FUNCTION commercial.guard_rfq_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.tenant_id,NEW.legal_entity_id,NEW.ref,NEW.mode,NEW.origin,NEW.destination,NEW.requirements,NEW.currency,NEW.response_deadline,NEW.created_by,NEW.created_at)
     IS DISTINCT FROM ROW(OLD.tenant_id,OLD.legal_entity_id,OLD.ref,OLD.mode,OLD.origin,OLD.destination,OLD.requirements,OLD.currency,OLD.response_deadline,OLD.created_by,OLD.created_at)
  THEN RAISE EXCEPTION 'RFQ requirements are immutable; create a new request' USING ERRCODE='integrity_constraint_violation'; END IF;
  IF NOT ((OLD.status='draft' AND NEW.status='issued') OR (OLD.status='issued' AND NEW.status='awarded'))
  THEN RAISE EXCEPTION 'Invalid RFQ transition' USING ERRCODE='integrity_constraint_violation'; END IF;
  IF NEW.status='awarded' AND EXISTS (SELECT 1 FROM commercial.rfq_offers WHERE id=NEW.awarded_offer_id AND tenant_id=NEW.tenant_id AND created_by=NEW.awarded_by)
  THEN RAISE EXCEPTION 'Offer recorder cannot award their own response' USING ERRCODE='integrity_constraint_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rfq_transition BEFORE UPDATE ON commercial.rfqs FOR EACH ROW EXECUTE FUNCTION commercial.guard_rfq_change();
CREATE FUNCTION commercial.guard_rfq_supplier() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM commercial.rfqs WHERE tenant_id=COALESCE(NEW.tenant_id,OLD.tenant_id) AND id=COALESCE(NEW.rfq_id,OLD.rfq_id)) IS DISTINCT FROM 'draft'
  THEN RAISE EXCEPTION 'Issued RFQ invitations are immutable' USING ERRCODE='integrity_constraint_violation'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER rfq_suppliers_frozen BEFORE INSERT OR UPDATE OR DELETE ON commercial.rfq_suppliers FOR EACH ROW EXECUTE FUNCTION commercial.guard_rfq_supplier();
SELECT platform.enforce_rls('commercial',t) FROM (VALUES ('rfqs'),('rfq_suppliers'),('rfq_offers')) v(t);
GRANT SELECT,INSERT,UPDATE ON commercial.rfqs TO dbl_app;
GRANT SELECT,INSERT ON commercial.rfq_suppliers,commercial.rfq_offers TO dbl_app;
