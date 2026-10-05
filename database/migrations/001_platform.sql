-- 001 Platform: tenants, identity directory, memberships, RBAC, audit, outbox, idempotency, sequences
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS org;
CREATE SCHEMA IF NOT EXISTS parties;
CREATE SCHEMA IF NOT EXISTS commercial;
CREATE SCHEMA IF NOT EXISTS logistics;
CREATE SCHEMA IF NOT EXISTS transport;
CREATE SCHEMA IF NOT EXISTS warehouse;
CREATE SCHEMA IF NOT EXISTS trade;
CREATE SCHEMA IF NOT EXISTS finance;
CREATE SCHEMA IF NOT EXISTS collab;
CREATE SCHEMA IF NOT EXISTS automation;
CREATE SCHEMA IF NOT EXISTS integ;

-- Tenant context set per transaction by the API: SELECT set_config('app.tenant_id', $1, true)
CREATE FUNCTION platform.current_tenant() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid $$;
CREATE FUNCTION platform.current_user_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- version/updated_at maintenance for optimistic concurrency (If-Match)
CREATE FUNCTION platform.bump_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.version := OLD.version + 1; NEW.updated_at := now(); RETURN NEW; END $$;

-- Append-only guard (audit, journals, custody movements)
CREATE FUNCTION platform.deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only table %.%: % is not allowed', TG_TABLE_SCHEMA, TG_TABLE_NAME, TG_OP USING ERRCODE='integrity_constraint_violation'; END $$;

CREATE TABLE platform.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  default_currency char(3) NOT NULL DEFAULT 'AED',
  default_timezone text NOT NULL DEFAULT 'Asia/Dubai',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.users (       -- identity directory (global). Authentication lives in the OIDC provider.
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL UNIQUE,     -- OIDC "sub"
  email text,
  display_name text,
  user_kind text NOT NULL DEFAULT 'person' CHECK (user_kind IN ('person','service')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  user_id uuid NOT NULL REFERENCES platform.users(id),
  workspace text NOT NULL DEFAULT 'staff' CHECK (workspace IN ('staff','customer','agent','transporter','driver','warehouse','platform_admin')),
  party_id uuid,                    -- external users: the party they represent (FK added in parties migration)
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE platform.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  key text NOT NULL,
  name text NOT NULL,
  UNIQUE (tenant_id, key), UNIQUE (tenant_id, id)
);
CREATE TABLE platform.role_permissions (
  tenant_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission ~ '^[a-z-]+(\.[a-z-]+)+$'),
  PRIMARY KEY (tenant_id, role_id, permission),
  FOREIGN KEY (tenant_id, role_id) REFERENCES platform.roles (tenant_id, id) ON DELETE CASCADE
);
CREATE TABLE platform.membership_roles (   -- a grant = role + scope
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  membership_id uuid NOT NULL,
  role_id uuid NOT NULL,
  legal_entity_id uuid,            -- NULL = all entities
  branch_id uuid,
  FOREIGN KEY (tenant_id, membership_id) REFERENCES platform.memberships (tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, role_id) REFERENCES platform.roles (tenant_id, id)
);

CREATE TABLE platform.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_kind text NOT NULL DEFAULT 'user' CHECK (actor_kind IN ('user','system','ai','integration','device')),
  request_id text,
  correlation_id text,
  action text NOT NULL,
  entity_type text,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'
);
CREATE INDEX ON platform.audit_events (tenant_id, entity_type, entity_id);
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON platform.audit_events FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();

CREATE TABLE platform.outbox (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  topic text NOT NULL,                       -- e.g. QuoteAccepted
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}',
  correlation_id text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX outbox_unpublished ON platform.outbox (id) WHERE published_at IS NULL;

CREATE TABLE platform.idempotency_keys (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  user_id uuid NOT NULL,
  operation text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status_code int,
  response_body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, operation, key)
);

CREATE TABLE platform.number_sequences (
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  key text NOT NULL,
  next_value bigint NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, key)
);
-- Human-readable references (job numbers etc.). Row-lock serialises allocation; gaps only if txn rolls back.
CREATE FUNCTION platform.next_ref(p_key text, p_prefix text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE v bigint; t uuid := platform.current_tenant();
BEGIN
  INSERT INTO platform.number_sequences(tenant_id, key, next_value) VALUES (t, p_key, 2)
  ON CONFLICT (tenant_id, key) DO UPDATE SET next_value = platform.number_sequences.next_value + 1
  RETURNING next_value - 1 INTO v;
  RETURN p_prefix || '-' || to_char(now(), 'YY') || '-' || lpad(v::text, 5, '0');
END $$;

CREATE SCHEMA IF NOT EXISTS ref;
CREATE TABLE ref.currencies (code char(3) PRIMARY KEY, name text NOT NULL, minor_units smallint NOT NULL);
INSERT INTO ref.currencies VALUES ('AED','UAE dirham',2),('USD','US dollar',2),('EUR','Euro',2),('CNY','Chinese yuan',2),('INR','Indian rupee',2),('SAR','Saudi riyal',2),('OMR','Omani rial',3);
