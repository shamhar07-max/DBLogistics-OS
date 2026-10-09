-- Check lifecycle invariants even when a runtime query bypasses the HTTP service.
CREATE FUNCTION commercial.guard_rfq_offer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r commercial.rfqs%ROWTYPE;
BEGIN
  SELECT * INTO r FROM commercial.rfqs WHERE tenant_id=NEW.tenant_id AND id=NEW.rfq_id FOR UPDATE;
  IF r.id IS NULL OR r.status <> 'issued' OR r.response_deadline <= now() OR NEW.valid_until < CURRENT_DATE
  THEN RAISE EXCEPTION 'Supplier responses require an issued, open request and valid terms' USING ERRCODE='integrity_constraint_violation'; END IF;
  IF NOT EXISTS (SELECT 1 FROM parties.parties WHERE tenant_id=NEW.tenant_id AND id=NEW.supplier_party_id AND status='active')
  THEN RAISE EXCEPTION 'Response supplier must be active' USING ERRCODE='integrity_constraint_violation'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER rfq_offer_guard BEFORE INSERT ON commercial.rfq_offers FOR EACH ROW EXECUTE FUNCTION commercial.guard_rfq_offer();
