-- 005 Documents (controlled evidence), Warehouse custody ledger, Trade (customs cases + release evidence)
CREATE TABLE platform.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  doc_type text NOT NULL, issuer_kind text NOT NULL CHECK (issuer_kind IN ('carrier','authority','customer','supplier','internal')),
  issuer_name text, external_reference text,
  related_type text NOT NULL, related_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','received','approved','superseded')),
  retention_category text NOT NULL DEFAULT 'trade-7y',
  approved_by uuid, approved_at timestamptz,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id)
);
CREATE TRIGGER documents_version BEFORE UPDATE ON platform.documents FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE platform.document_versions (   -- immutable once clean
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, document_id uuid NOT NULL,
  version_no int NOT NULL, storage_key text NOT NULL, sha256 text NOT NULL, size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  content_type text NOT NULL, scan_status text NOT NULL DEFAULT 'pending' CHECK (scan_status IN ('pending','clean','infected','failed')),
  template_version text, data_snapshot jsonb, extracted jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, document_id, version_no),
  FOREIGN KEY (tenant_id, document_id) REFERENCES platform.documents (tenant_id, id)
);
CREATE TABLE platform.upload_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  storage_key text NOT NULL UNIQUE, content_type text NOT NULL, max_bytes bigint NOT NULL,
  created_by uuid NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);

CREATE TABLE warehouse.stock_lots (   -- CUSTODY stock: owned by the customer, held by the facility. Never forwarder inventory.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
  facility_id uuid NOT NULL, location_id uuid, owner_party_id uuid NOT NULL, cargo_unit_id uuid,
  description text NOT NULL, batch text,
  qty_on_hand numeric(18,4) NOT NULL DEFAULT 0, qty_reserved numeric(18,4) NOT NULL DEFAULT 0,
  condition text NOT NULL DEFAULT 'good' CHECK (condition IN ('good','damaged','quarantined')),
  customs_status text NOT NULL DEFAULT 'bonded' CHECK (customs_status IN ('bonded','duty_paid','free_circulation')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES org.facilities (tenant_id, id),
  FOREIGN KEY (tenant_id, location_id) REFERENCES org.locations (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_party_id) REFERENCES parties.parties (tenant_id, id),
  FOREIGN KEY (tenant_id, cargo_unit_id) REFERENCES logistics.cargo_units (tenant_id, id),
  CONSTRAINT stock_non_negative CHECK (qty_on_hand >= 0 AND qty_reserved >= 0),
  CONSTRAINT stock_reserved_le_on_hand CHECK (qty_reserved <= qty_on_hand)
);
CREATE TRIGGER stock_lots_version BEFORE UPDATE ON warehouse.stock_lots FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE warehouse.custody_movements (  -- append-only ledger; command_key makes retries harmless
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL, lot_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('receipt','reserve','unreserve','release','adjustment')),
  qty numeric(18,4) NOT NULL, ref_type text, ref_id uuid, command_key text NOT NULL,
  actor_user_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, command_key),
  FOREIGN KEY (tenant_id, lot_id) REFERENCES warehouse.stock_lots (tenant_id, id)
);
CREATE TRIGGER custody_append_only BEFORE UPDATE OR DELETE ON warehouse.custody_movements FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE TABLE warehouse.holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, lot_id uuid NOT NULL,
  reason text NOT NULL, kind text NOT NULL DEFAULT 'quarantine' CHECK (kind IN ('quarantine','customs','quality','legal')),
  placed_by uuid, placed_at timestamptz NOT NULL DEFAULT now(), released_by uuid, released_at timestamptz,
  FOREIGN KEY (tenant_id, lot_id) REFERENCES warehouse.stock_lots (tenant_id, id)
);
CREATE INDEX ON warehouse.holds (tenant_id, lot_id) WHERE released_at IS NULL;

CREATE TABLE trade.customs_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, ref text NOT NULL,
  job_id uuid NOT NULL, shipment_id uuid, importer_party_id uuid NOT NULL,
  procedure text NOT NULL CHECK (procedure IN ('import','export','transit','re_export','warehouse_entry')),
  internal_status text NOT NULL DEFAULT 'preparing' CHECK (internal_status IN ('preparing','submitted','held','release_recorded')),
  authority_status text,                     -- AS REPORTED by the authority — never inferred from internal status
  authority_reference text, checklist jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, job_id) REFERENCES logistics.jobs (tenant_id, id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id),
  FOREIGN KEY (tenant_id, importer_party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TRIGGER customs_version BEFORE UPDATE ON trade.customs_cases FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE trade.release_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, case_id uuid NOT NULL,
  document_id uuid NOT NULL, authority_reference text NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, case_id),
  FOREIGN KEY (tenant_id, case_id) REFERENCES trade.customs_cases (tenant_id, id),
  FOREIGN KEY (tenant_id, document_id) REFERENCES platform.documents (tenant_id, id)
);
CREATE TABLE warehouse.release_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, ref text NOT NULL,
  lot_id uuid NOT NULL, qty numeric(18,4) NOT NULL CHECK (qty > 0), consignee text,
  customs_case_id uuid,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','authorized','released','rejected')),
  requested_by uuid NOT NULL, authorized_by uuid, released_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, lot_id) REFERENCES warehouse.stock_lots (tenant_id, id),
  FOREIGN KEY (tenant_id, customs_case_id) REFERENCES trade.customs_cases (tenant_id, id),
  CHECK (authorized_by IS NULL OR authorized_by <> requested_by)       -- maker != checker
);
CREATE TRIGGER release_orders_version BEFORE UPDATE ON warehouse.release_orders FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
