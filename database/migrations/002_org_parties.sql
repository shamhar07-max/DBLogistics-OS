-- 002 Organization & parties. Composite (tenant_id, id) uniques let child tables use composite FKs,
-- so a row can never reference another tenant's parent.
CREATE TABLE org.legal_entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  name text NOT NULL,
  trade_license text, tax_registration_number text,
  base_currency char(3) NOT NULL REFERENCES ref.currencies(code),
  jurisdiction text NOT NULL DEFAULT 'AE',
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id)
);
CREATE TABLE org.branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL,
  name text NOT NULL, kind text NOT NULL DEFAULT 'operated_office' CHECK (kind IN ('operated_office','agent_office')),
  country char(2) NOT NULL DEFAULT 'AE',
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id)
);
CREATE TABLE org.facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, legal_entity_id uuid NOT NULL, branch_id uuid,
  name text NOT NULL, kind text NOT NULL CHECK (kind IN ('warehouse','yard','office','cfs')),
  regulatory_profile jsonb NOT NULL DEFAULT '{}',   -- approval ids, scopes, expiry (customs / excise / VAT designated-zone are SEPARATE keys)
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, legal_entity_id) REFERENCES org.legal_entities (tenant_id, id),
  FOREIGN KEY (tenant_id, branch_id) REFERENCES org.branches (tenant_id, id)
);
CREATE TABLE org.locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL, facility_id uuid NOT NULL,
  code text NOT NULL, zone text, kind text NOT NULL DEFAULT 'bin',
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, facility_id, code),
  FOREIGN KEY (tenant_id, facility_id) REFERENCES org.facilities (tenant_id, id)
);

CREATE TABLE parties.parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES platform.tenants(id),
  legal_name text NOT NULL, trading_name text, tax_registration_number text, country char(2),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','blocked','archived')),
  credit_limit numeric(18,4), credit_currency char(3),
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), version int NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, id)
);
CREATE UNIQUE INDEX parties_trn_unique ON parties.parties (tenant_id, tax_registration_number) WHERE tax_registration_number IS NOT NULL;  -- duplicate resolution
CREATE TABLE parties.party_roles (   -- one identity, many commercial roles
  tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('customer','supplier','shipper','consignee','agent','transporter','carrier','insurer','broker')),
  PRIMARY KEY (tenant_id, party_id, role),
  FOREIGN KEY (tenant_id, party_id) REFERENCES parties.parties (tenant_id, id) ON DELETE CASCADE
);
CREATE TABLE parties.contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  name text NOT NULL, email text, phone text, preferred_channel text,
  FOREIGN KEY (tenant_id, party_id) REFERENCES parties.parties (tenant_id, id) ON DELETE CASCADE
);
CREATE TABLE parties.bank_details (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  account_name text NOT NULL, iban text NOT NULL, swift text, currency char(3) NOT NULL,
  active_from timestamptz NOT NULL DEFAULT now(), active_to timestamptz,
  FOREIGN KEY (tenant_id, party_id) REFERENCES parties.parties (tenant_id, id)
);
-- Bank details change ONLY through an approved change request (maker != checker).
CREATE TABLE parties.bank_detail_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, party_id uuid NOT NULL,
  proposed jsonb NOT NULL,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','rejected')),
  proposed_by uuid NOT NULL, proposed_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid, decided_at timestamptz, callback_verified boolean NOT NULL DEFAULT false,
  FOREIGN KEY (tenant_id, party_id) REFERENCES parties.parties (tenant_id, id),
  CHECK (decided_by IS NULL OR decided_by <> proposed_by),
  CHECK (status <> 'approved' OR (decided_by IS NOT NULL AND callback_verified))
);
ALTER TABLE platform.memberships ADD CONSTRAINT memberships_party_fk FOREIGN KEY (tenant_id, party_id) REFERENCES parties.parties (tenant_id, id);
