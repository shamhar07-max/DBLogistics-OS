-- 015 Branded documents (issuer profile, party address), customer messaging (visibility), outbound email/WhatsApp queue, document extraction.

-- Issuer profile printed on every generated document (header/footer) + payment instructions on invoices.
ALTER TABLE org.legal_entities
  ADD COLUMN address text, ADD COLUMN email text, ADD COLUMN phone text, ADD COLUMN website text,
  ADD COLUMN bank_name text, ADD COLUMN bank_account_name text, ADD COLUMN bank_iban text, ADD COLUMN bank_swift text;
ALTER TABLE parties.parties ADD COLUMN address text;
-- Consent flags: WhatsApp business messages need explicit opt-in; email can be opted out.
ALTER TABLE parties.contacts ADD COLUMN whatsapp_opt_in boolean NOT NULL DEFAULT false, ADD COLUMN email_opt_out boolean NOT NULL DEFAULT false;

-- Conversation log: customers see ONLY messages marked shared; internal notes never leave the staff workspace.
ALTER TABLE collab.messages ADD COLUMN visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','shared'));
ALTER TABLE collab.messages DROP CONSTRAINT messages_channel_check;
ALTER TABLE collab.messages ADD CONSTRAINT messages_channel_check CHECK (channel IN ('internal','email','whatsapp','call','portal'));
ALTER TABLE collab.messages ADD CONSTRAINT messages_internal_never_shared CHECK (NOT (channel = 'internal' AND visibility = 'shared'));
CREATE INDEX messages_shared_idx ON collab.messages (tenant_id, related_type, related_id, created_at) WHERE visibility = 'shared';

-- Outbound notifications: one row per recipient per purpose; the worker sends with retries and records provider ids.
CREATE TABLE integ.outbound_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  channel text NOT NULL CHECK (channel IN ('email','whatsapp')), to_address text NOT NULL, to_name text, template text NOT NULL, vars jsonb NOT NULL DEFAULT '{}',
  language text NOT NULL DEFAULT 'en', related_type text, related_id uuid, party_id uuid,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','read','failed','cancelled')),
  attempts int NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(), provider text, provider_message_id text, last_error text,
  dedupe_key text NOT NULL, created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, delivered_at timestamptz,
  UNIQUE (tenant_id, dedupe_key)                          -- the same event can never notify the same person twice
);
CREATE INDEX outbound_due ON integ.outbound_messages (next_attempt_at) WHERE status = 'queued';
CREATE INDEX outbound_provider_id ON integ.outbound_messages (tenant_id, provider, provider_message_id);

-- Text and structured fields extracted from document versions (OCR / text layer). Derived data: never authoritative until a human uses it.
CREATE TABLE platform.document_extractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id), document_version_id uuid NOT NULL,
  engine text NOT NULL, status text NOT NULL CHECK (status IN ('done','failed','unsupported')), page_count int, text text, fields jsonb NOT NULL DEFAULT '{}', confidence numeric(5,2), error text,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (tenant_id, document_version_id)
);

SELECT platform.enforce_rls('integ', 'outbound_messages'); SELECT platform.enforce_rls('platform', 'document_extractions');
GRANT SELECT, INSERT, UPDATE ON integ.outbound_messages TO dbl_app; GRANT SELECT ON platform.document_extractions TO dbl_app;

-- Worker (tenant-bound, least privilege): sends queued messages, writes extraction results, resolves recipients for workflow notifications.
CREATE POLICY worker_scoped ON integ.outbound_messages FOR ALL TO dbl_worker USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON platform.document_extractions FOR ALL TO dbl_worker USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON logistics.jobs FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON finance.invoices FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON commercial.quotes FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON parties.parties FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON parties.contacts FOR SELECT TO dbl_worker USING (tenant_id = platform.current_tenant());
CREATE POLICY worker_scoped ON collab.messages FOR ALL TO dbl_worker USING (tenant_id = platform.current_tenant()) WITH CHECK (tenant_id = platform.current_tenant());
GRANT SELECT, INSERT, UPDATE ON integ.outbound_messages TO dbl_worker; GRANT SELECT, INSERT, UPDATE ON platform.document_extractions TO dbl_worker;
GRANT USAGE ON SCHEMA finance, commercial, parties TO dbl_worker; GRANT USAGE ON ALL SEQUENCES IN SCHEMA collab TO dbl_worker;
GRANT SELECT ON logistics.jobs, finance.invoices, commercial.quotes, parties.parties, parties.contacts TO dbl_worker;
GRANT SELECT, INSERT ON collab.messages TO dbl_worker; REVOKE UPDATE, DELETE ON collab.messages FROM dbl_worker;
