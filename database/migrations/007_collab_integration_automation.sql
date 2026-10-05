-- 007 Collaboration (approvals, tasks), Integrations (connections, inbox), Automation (workflows), AI usage
CREATE TABLE collab.approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, kind text NOT NULL,
  subject_type text NOT NULL, subject_id uuid NOT NULL, summary text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  requested_by uuid NOT NULL, decided_by uuid, decided_at timestamptz, decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE TABLE collab.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, title text NOT NULL,
  related_type text, related_id uuid, assignee_user_id uuid, due_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','cancelled')),
  origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','automation','ai')), created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE integ.connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, legal_entity_id uuid,
  provider text NOT NULL, capability text NOT NULL, credential_ref text NOT NULL,   -- reference to secrets manager, never the secret
  external_account text, mapping_version text, sync_cursor text, webhook_secret_ref text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','failing','disabled')),
  last_success_at timestamptz, last_error text,
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, provider, capability)
);
CREATE TABLE integ.inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, provider text NOT NULL,
  external_event_id text NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL,
  event_time timestamptz, received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz,
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','processed','failed','ignored')), error text,
  UNIQUE (tenant_id, provider, external_event_id)       -- duplicate webhooks => one business effect
);

CREATE TABLE automation.workflow_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, key text NOT NULL, version int NOT NULL,
  trigger_topic text NOT NULL, definition jsonb NOT NULL, status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  owner_user_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id), UNIQUE (tenant_id, key, version)
);
CREATE TABLE automation.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, definition_id uuid NOT NULL, trigger_event_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','waiting','completed','failed','cancelled')),
  state jsonb NOT NULL DEFAULT '{}', resume_at timestamptz, attempts int NOT NULL DEFAULT 0, last_error text,
  started_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  UNIQUE (tenant_id, definition_id, trigger_event_id),       -- retries never run a workflow twice for one event
  FOREIGN KEY (tenant_id, definition_id) REFERENCES automation.workflow_definitions (tenant_id, id)
);
CREATE TABLE automation.ai_usage (
  tenant_id uuid NOT NULL, day date NOT NULL, workload text NOT NULL, tool_calls int NOT NULL DEFAULT 0, tokens bigint NOT NULL DEFAULT 0,
  cost_micros bigint NOT NULL DEFAULT 0, budget_micros bigint NOT NULL DEFAULT 5000000,
  PRIMARY KEY (tenant_id, day, workload)
);
