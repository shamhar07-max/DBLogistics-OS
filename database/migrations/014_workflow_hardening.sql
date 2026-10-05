-- 014 Workflow engine hardening: step log, heartbeat/stale recovery, 'skipped' runs, immutable published definitions,
--     at most one active version per workflow key, no deletion of definitions or runs.
ALTER TABLE automation.workflow_runs
  ADD COLUMN log jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN heartbeat_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN cancelled_by uuid;
ALTER TABLE automation.workflow_runs DROP CONSTRAINT workflow_runs_status_check;
ALTER TABLE automation.workflow_runs ADD CONSTRAINT workflow_runs_status_check CHECK (status IN ('running','waiting','completed','failed','cancelled','skipped'));
CREATE INDEX workflow_runs_recovery ON automation.workflow_runs (status, resume_at, heartbeat_at) WHERE status IN ('waiting','running');

ALTER TABLE automation.workflow_definitions
  ADD COLUMN description text, ADD COLUMN activated_by uuid, ADD COLUMN activated_at timestamptz, ADD COLUMN retired_at timestamptz;
CREATE UNIQUE INDEX workflow_one_active_version ON automation.workflow_definitions (tenant_id, key) WHERE status = 'active';

CREATE FUNCTION automation.guard_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tenant_id <> OLD.tenant_id OR NEW.key <> OLD.key OR NEW.version <> OLD.version OR NEW.trigger_topic <> OLD.trigger_topic OR NEW.definition <> OLD.definition THEN
    RAISE EXCEPTION 'Workflow definitions are immutable: publish a new version instead' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> OLD.status AND NOT ((OLD.status = 'draft' AND NEW.status IN ('active','retired')) OR (OLD.status = 'active' AND NEW.status = 'retired')) THEN
    RAISE EXCEPTION 'Invalid workflow status change % -> %', OLD.status, NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER workflow_definitions_guard BEFORE UPDATE ON automation.workflow_definitions FOR EACH ROW EXECUTE FUNCTION automation.guard_definition();
REVOKE DELETE ON automation.workflow_definitions, automation.workflow_runs FROM dbl_app;
