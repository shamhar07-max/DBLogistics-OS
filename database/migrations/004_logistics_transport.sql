-- 004 Logistics (jobs / shipments / legs / bookings / tracking) and Transport (trips / POD / device commands)
CREATE TABLE logistics.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  ref text NOT NULL, quote_id uuid, customer_party_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','executing','delivered','closed','cancelled')),
  finance_status text NOT NULL DEFAULT 'open' CHECK (finance_status IN ('open','partially_billed','billed','settled','closed')),
  currency char(3) NOT NULL REFERENCES ref.currencies(code),
  owner_user_id uuid, closed_at timestamptz, closure_notes jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref), UNIQUE (tenant_id, quote_id),   -- one job per accepted quote
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id),
  FOREIGN KEY (tenant_id, quote_id) REFERENCES commercial.quotes (tenant_id, id),
  FOREIGN KEY (tenant_id, customer_party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TRIGGER jobs_version BEFORE UPDATE ON logistics.jobs FOR EACH ROW EXECUTE FUNCTION platform.bump_version();

CREATE TABLE logistics.shipments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, job_id uuid NOT NULL,
  ref text NOT NULL, mode text NOT NULL, origin text NOT NULL, destination text NOT NULL, incoterm text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','executing','delivered','cancelled')),
  documents_status text NOT NULL DEFAULT 'missing' CHECK (documents_status IN ('missing','draft','received','approved')),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, job_id) REFERENCES logistics.jobs (tenant_id, id)
);
CREATE TRIGGER shipments_version BEFORE UPDATE ON logistics.shipments FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE logistics.legs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, shipment_id uuid NOT NULL,
  seq int NOT NULL, mode text NOT NULL, operator_party_id uuid, origin text NOT NULL, destination text NOT NULL,
  planned_departure timestamptz, planned_arrival timestamptz, estimated_arrival timestamptz, actual_arrival timestamptz,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, shipment_id, seq),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id)
);
CREATE TABLE logistics.cargo_units (   -- identifiable cargo: owner + quantity (custody follows owner, not the forwarder)
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, shipment_id uuid NOT NULL,
  kind text NOT NULL DEFAULT 'pallet', description text NOT NULL,
  quantity numeric(18,4) NOT NULL CHECK (quantity > 0), gross_weight_kg numeric(18,4), volume_cbm numeric(18,4),
  owner_party_id uuid NOT NULL, hs_code text, batch text,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TABLE logistics.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, shipment_id uuid NOT NULL, leg_id uuid,
  carrier_party_id uuid NOT NULL, external_ref text,
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','confirmed','amended','cancelled')),
  outcome_unknown boolean NOT NULL DEFAULT false,   -- provider call timed out: reconcile before re-submitting
  request_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, request_key),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id),
  FOREIGN KEY (tenant_id, carrier_party_id) REFERENCES parties.parties (tenant_id, id),
  CHECK (status <> 'confirmed' OR external_ref IS NOT NULL)
);
CREATE TRIGGER bookings_version BEFORE UPDATE ON logistics.bookings FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE logistics.tracking_events (   -- late / duplicate / out-of-order tolerant event log
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, shipment_id uuid NOT NULL,
  code text NOT NULL, event_time timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('carrier','supplier','manual','device','inferred')),
  is_actual boolean NOT NULL, external_event_id text, corrects_event_id uuid, detail jsonb NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, source, external_event_id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id),
  CHECK (source <> 'inferred' OR is_actual = false)      -- estimated events cannot masquerade as actual
);
CREATE INDEX ON logistics.tracking_events (tenant_id, shipment_id, event_time);

CREATE TABLE transport.trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, ref text NOT NULL,
  transporter_party_id uuid NOT NULL, driver_user_id uuid, vehicle_ref text,
  status text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','dispatched','in_progress','completed','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, ref),
  FOREIGN KEY (tenant_id, transporter_party_id) REFERENCES parties.parties (tenant_id, id)
);
CREATE TRIGGER trips_version BEFORE UPDATE ON transport.trips FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE transport.trip_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, trip_id uuid NOT NULL, seq int NOT NULL,
  kind text NOT NULL CHECK (kind IN ('pickup','delivery','return_empty')), shipment_id uuid, address text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','arrived','done','failed')),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, trip_id, seq),
  FOREIGN KEY (tenant_id, trip_id) REFERENCES transport.trips (tenant_id, id),
  FOREIGN KEY (tenant_id, shipment_id) REFERENCES logistics.shipments (tenant_id, id)
);
CREATE TABLE transport.proofs_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, trip_stop_id uuid NOT NULL,
  signed_by text NOT NULL, captured_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  device_id text, document_id uuid, command_id uuid NOT NULL,
  UNIQUE (tenant_id, trip_stop_id), UNIQUE (tenant_id, command_id),
  FOREIGN KEY (tenant_id, trip_stop_id) REFERENCES transport.trip_stops (tenant_id, id)
);
-- Offline command ledger: unique command id => a command submitted twice has one effect.
CREATE TABLE transport.device_commands (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id), command_id uuid NOT NULL,
  device_id text NOT NULL, actor_user_id uuid NOT NULL, type text NOT NULL,
  observed_version int, device_time timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('accepted','rejected','conflict')), result jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (tenant_id, command_id)
);
