-- 006 Finance: chart of accounts, periods, immutable balanced journals, charges, invoices, supplier bills, payments
CREATE TABLE finance.accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  code text NOT NULL, name text NOT NULL, type text NOT NULL CHECK (type IN ('asset','liability','revenue','expense','equity')),
  system_key text,   -- stable key used by posting templates: AR, AP, BANK, REVENUE, COST, ACCRUED_COST, VAT_OUT, VAT_IN
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, legal_entity_id, code), UNIQUE (tenant_id, legal_entity_id, system_key),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id)
);
CREATE TABLE finance.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  start_date date NOT NULL, end_date date NOT NULL, status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  UNIQUE (tenant_id, legal_entity_id, start_date), CHECK (end_date >= start_date),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id)
);
CREATE TABLE finance.journals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  ref text NOT NULL, posting_date date NOT NULL, currency char(3) NOT NULL REFERENCES ref.currencies(code),
  source_type text NOT NULL, source_id uuid NOT NULL, description text,
  reverses_journal_id uuid, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),

  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id),
  FOREIGN KEY (tenant_id, reverses_journal_id) REFERENCES finance.journals (tenant_id, id)
);
-- one posting journal per source: partial unique index (NULL reverses) — the UNIQUE above does not catch NULLs
CREATE UNIQUE INDEX one_posting_per_source ON finance.journals (tenant_id, source_type, source_id) WHERE reverses_journal_id IS NULL;
CREATE TABLE finance.journal_lines (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL, journal_id uuid NOT NULL,
  account_id uuid NOT NULL, debit numeric(18,4) NOT NULL DEFAULT 0, credit numeric(18,4) NOT NULL DEFAULT 0,
  party_id uuid, job_id uuid, memo text,
  CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0) AND (debit + credit) > 0),
  FOREIGN KEY (tenant_id, journal_id) REFERENCES finance.journals (tenant_id, id),
  FOREIGN KEY (tenant_id, account_id) REFERENCES finance.accounts (tenant_id, id)
);
CREATE INDEX ON finance.journal_lines (tenant_id, journal_id);
CREATE INDEX ON finance.journal_lines (tenant_id, job_id);
CREATE TRIGGER journals_append_only BEFORE UPDATE OR DELETE ON finance.journals FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE TRIGGER journal_lines_append_only BEFORE UPDATE OR DELETE ON finance.journal_lines FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
-- Balanced-journal invariant, enforced at COMMIT by the database itself.
CREATE FUNCTION finance.assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; jid uuid := COALESCE(NEW.journal_id, OLD.journal_id);
BEGIN
  SELECT COALESCE(sum(debit),0), COALESCE(sum(credit),0) INTO d, c FROM finance.journal_lines WHERE journal_id = jid;
  IF d <> c THEN RAISE EXCEPTION 'journal % is unbalanced: debit % <> credit %', jid, d, c USING ERRCODE='integrity_constraint_violation'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON finance.journal_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION finance.assert_journal_balanced();

CREATE TABLE finance.charges (   -- revenue and cost lines belonging to a job
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, job_id uuid NOT NULL, shipment_id uuid,
  kind text NOT NULL CHECK (kind IN ('revenue','cost')),
  source_event_key text NOT NULL,      -- one service event => one charge (idempotent creation)
  description text NOT NULL, quantity numeric(18,4) NOT NULL CHECK (quantity > 0), unit_amount numeric(18,4) NOT NULL CHECK (unit_amount >= 0),
  amount numeric(18,4) GENERATED ALWAYS AS (round(quantity * unit_amount, 4)) STORED,
  currency char(3) NOT NULL REFERENCES ref.currencies(code), tax_code text NOT NULL DEFAULT 'SR5', tax_rationale text,
  party_id uuid,                          -- customer (revenue) or supplier (cost)
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accrued','invoiced','billed','cancelled')),
  accrual_journal_id uuid, invoice_id uuid, supplier_bill_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, job_id, source_event_key),
  FOREIGN KEY (tenant_id, job_id) REFERENCES logistics.jobs (tenant_id, id)
);
CREATE TRIGGER charges_version BEFORE UPDATE ON finance.charges FOR EACH ROW EXECUTE FUNCTION platform.bump_version();

CREATE TABLE finance.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  job_id uuid NOT NULL, customer_party_id uuid NOT NULL, ref text,   -- document number allocated AT POSTING
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','posted','credited')),
  einvoice_status text NOT NULL DEFAULT 'not_required' CHECK (einvoice_status IN ('not_required','pending','submitted','acknowledged','rejected')),
  currency char(3) NOT NULL REFERENCES ref.currencies(code),
  subtotal numeric(18,4) NOT NULL DEFAULT 0, tax_total numeric(18,4) NOT NULL DEFAULT 0, total numeric(18,4) NOT NULL DEFAULT 0,
  amount_allocated numeric(18,4) NOT NULL DEFAULT 0,
  posting_date date, posted_journal_id uuid, approved_by uuid, posted_by uuid, due_date date,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id),
  FOREIGN KEY (tenant_id, job_id) REFERENCES logistics.jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_party_id) REFERENCES parties.parties (tenant_id, id),
  CHECK (status NOT IN ('posted','credited') OR (ref IS NOT NULL AND posted_journal_id IS NOT NULL AND posting_date IS NOT NULL)),
  CONSTRAINT invoice_allocation_bounds CHECK (amount_allocated >= 0 AND amount_allocated <= total)
);
CREATE TRIGGER invoices_version BEFORE UPDATE ON finance.invoices FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE finance.invoice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, invoice_id uuid NOT NULL, charge_id uuid NOT NULL,
  description text NOT NULL, net_amount numeric(18,4) NOT NULL, tax_code text NOT NULL, tax_rate numeric(7,4) NOT NULL, tax_amount numeric(18,4) NOT NULL,
  tax_rationale text,
  UNIQUE (tenant_id, charge_id),             -- a charge can be invoiced once
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id),
  FOREIGN KEY (tenant_id, charge_id) REFERENCES finance.charges (tenant_id, id)
);
CREATE TABLE finance.supplier_bills (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  supplier_party_id uuid NOT NULL, job_id uuid NOT NULL, supplier_invoice_no text NOT NULL,
  currency char(3) NOT NULL REFERENCES ref.currencies(code), amount numeric(18,4) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('draft','posted','paid')), posted_journal_id uuid, variance numeric(18,4) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, supplier_party_id, supplier_invoice_no),       -- duplicate-bill detection
  FOREIGN KEY (tenant_id, supplier_party_id) REFERENCES parties.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, job_id) REFERENCES logistics.jobs (tenant_id, id)
);
CREATE TABLE finance.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  direction text NOT NULL DEFAULT 'receipt' CHECK (direction IN ('receipt','disbursement')),
  party_id uuid NOT NULL, currency char(3) NOT NULL REFERENCES ref.currencies(code),
  amount numeric(18,4) NOT NULL CHECK (amount > 0), amount_allocated numeric(18,4) NOT NULL DEFAULT 0,
  received_on date NOT NULL, bank_reference text, recorded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, bank_reference),
  CONSTRAINT payment_allocation_bounds CHECK (amount_allocated >= 0 AND amount_allocated <= amount),   -- cannot allocate beyond available amount
  FOREIGN KEY (tenant_id, party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TRIGGER payments_version BEFORE UPDATE ON finance.payments FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE finance.payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, payment_id uuid NOT NULL, invoice_id uuid NOT NULL,
  amount numeric(18,4) NOT NULL CHECK (amount > 0), allocation_key text NOT NULL, journal_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, allocation_key),
  FOREIGN KEY (tenant_id, payment_id) REFERENCES finance.payments (tenant_id, id),
  FOREIGN KEY (tenant_id, invoice_id) REFERENCES finance.invoices (tenant_id, id)
);
