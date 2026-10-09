CREATE TABLE collab.work_calendars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,key text NOT NULL,name text NOT NULL,version int NOT NULL,
 calendar jsonb NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,key,version),FOREIGN KEY(tenant_id,created_by) REFERENCES platform.memberships(tenant_id,id),CHECK(version>0)
);
CREATE TRIGGER calendar_immutable BEFORE UPDATE OR DELETE ON collab.work_calendars FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE TABLE collab.work_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,legal_entity_id uuid NOT NULL,branch_id uuid,key text NOT NULL,name text NOT NULL,version int NOT NULL,
 calendar_id uuid NOT NULL,steps jsonb NOT NULL,created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE NULLS NOT DISTINCT(tenant_id,legal_entity_id,branch_id,key,version),
 FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES org.legal_entities(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id,branch_id) REFERENCES org.branches(tenant_id,legal_entity_id,id),
 FOREIGN KEY(tenant_id,calendar_id) REFERENCES collab.work_calendars(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES platform.memberships(tenant_id,id),CHECK(version>0)
);
CREATE TRIGGER template_immutable BEFORE UPDATE OR DELETE ON collab.work_templates FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE TABLE collab.work_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,legal_entity_id uuid NOT NULL,branch_id uuid,title text NOT NULL,description text NOT NULL,department text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('blocked','open','in_progress','waiting','done','cancelled')),priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 complexity int NOT NULL CHECK(complexity BETWEEN 1 AND 100),assignee_membership_id uuid,created_by uuid NOT NULL,
 calendar_id uuid NOT NULL,sla_seconds integer NOT NULL CHECK(sla_seconds>0),remaining_seconds numeric NOT NULL CHECK(remaining_seconds>=0),due_at timestamptz,paused_at timestamptz,breached_at timestamptz,
 template_id uuid,instance_id uuid,step_key text,depends_on text[] NOT NULL DEFAULT '{}',completed_at timestamptz,completed_by uuid,
 version int NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),UNIQUE(tenant_id,instance_id,step_key),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES org.legal_entities(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id,branch_id) REFERENCES org.branches(tenant_id,legal_entity_id,id),
 FOREIGN KEY(tenant_id,calendar_id) REFERENCES collab.work_calendars(tenant_id,id),FOREIGN KEY(tenant_id,template_id) REFERENCES collab.work_templates(tenant_id,id),
 FOREIGN KEY(tenant_id,created_by) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,assignee_membership_id) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,completed_by) REFERENCES platform.memberships(tenant_id,id),
 CHECK((status='waiting')=(paused_at IS NOT NULL)),CHECK((status IN ('done','cancelled'))=(completed_at IS NOT NULL)),CHECK((status IN ('open','in_progress'))=(due_at IS NOT NULL))
);
CREATE INDEX work_queue ON collab.work_items(tenant_id,legal_entity_id,department,status,due_at);
CREATE TRIGGER work_item_version BEFORE UPDATE ON collab.work_items FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE collab.work_capacities (
 tenant_id uuid NOT NULL,legal_entity_id uuid NOT NULL,branch_id uuid,membership_id uuid NOT NULL,department text NOT NULL,capacity_points int NOT NULL CHECK(capacity_points BETWEEN 1 AND 1000),available boolean NOT NULL DEFAULT true,
 UNIQUE NULLS NOT DISTINCT(tenant_id,legal_entity_id,branch_id,membership_id,department),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES org.legal_entities(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id,branch_id) REFERENCES org.branches(tenant_id,legal_entity_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES platform.memberships(tenant_id,id)
);
CREATE TABLE collab.shift_handovers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,sender_membership_id uuid NOT NULL,recipient_membership_id uuid NOT NULL,note text NOT NULL,status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','acknowledged')),
 acknowledged_at timestamptz,acknowledgement_note text,created_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,sender_membership_id) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,recipient_membership_id) REFERENCES platform.memberships(tenant_id,id),CHECK(sender_membership_id<>recipient_membership_id),CHECK((status='acknowledged')=(acknowledged_at IS NOT NULL))
);
CREATE TABLE collab.handover_items (
 tenant_id uuid NOT NULL,handover_id uuid NOT NULL,work_item_id uuid NOT NULL,item_version int NOT NULL,
 PRIMARY KEY(tenant_id,handover_id,work_item_id),FOREIGN KEY(tenant_id,handover_id) REFERENCES collab.shift_handovers(tenant_id,id),FOREIGN KEY(tenant_id,work_item_id) REFERENCES collab.work_items(tenant_id,id)
);
CREATE TRIGGER handover_items_immutable BEFORE UPDATE OR DELETE ON collab.handover_items FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE TRIGGER handover_version BEFORE UPDATE ON collab.shift_handovers FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
SELECT platform.enforce_rls('collab','work_calendars');SELECT platform.enforce_rls('collab','work_templates');SELECT platform.enforce_rls('collab','work_items');SELECT platform.enforce_rls('collab','work_capacities');SELECT platform.enforce_rls('collab','shift_handovers');SELECT platform.enforce_rls('collab','handover_items');
GRANT SELECT,INSERT ON collab.work_calendars,collab.work_templates,collab.handover_items TO dbl_app;
GRANT SELECT,INSERT,UPDATE ON collab.work_items,collab.work_capacities,collab.shift_handovers TO dbl_app;
-- Schema owner bypass is limited to this transactional data migration. Runtime RLS stays enabled.
ALTER TABLE platform.roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.role_permissions NO FORCE ROW LEVEL SECURITY;
-- Add new permissions to existing tenants as well as newly provisioned tenants.
INSERT INTO platform.role_permissions(tenant_id,role_id,permission) SELECT tenant_id,id,p FROM platform.roles CROSS JOIN unnest(ARRAY['work.view','work.manage','work.configure']) p WHERE key='owner' ON CONFLICT DO NOTHING;
INSERT INTO platform.role_permissions(tenant_id,role_id,permission) SELECT tenant_id,id,p FROM platform.roles CROSS JOIN unnest(ARRAY['work.view','work.manage']) p WHERE key IN ('sales','pricing','freight_ops','customer_service','dispatcher','warehouse_supervisor','warehouse_operator','customs_specialist','accountant','finance_manager','hr','quality_manager') ON CONFLICT DO NOTHING;
ALTER TABLE platform.roles FORCE ROW LEVEL SECURITY;
ALTER TABLE platform.role_permissions FORCE ROW LEVEL SECURITY;
CREATE POLICY worker_scoped ON collab.work_items FOR ALL TO dbl_worker USING(tenant_id=platform.current_tenant()) WITH CHECK(tenant_id=platform.current_tenant());
GRANT SELECT,UPDATE(breached_at) ON collab.work_items TO dbl_worker;
GRANT INSERT ON platform.outbox TO dbl_worker;
CREATE FUNCTION collab.guard_work_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.legal_entity_id,NEW.branch_id,NEW.title,NEW.description,NEW.department,NEW.calendar_id,NEW.sla_seconds,NEW.template_id,NEW.instance_id,NEW.step_key,NEW.depends_on,NEW.created_by,NEW.complexity,NEW.priority)
 IS DISTINCT FROM (OLD.tenant_id,OLD.legal_entity_id,OLD.branch_id,OLD.title,OLD.description,OLD.department,OLD.calendar_id,OLD.sla_seconds,OLD.template_id,OLD.instance_id,OLD.step_key,OLD.depends_on,OLD.created_by,OLD.complexity,OLD.priority) THEN RAISE EXCEPTION 'work definition is immutable' USING ERRCODE='23000';END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status='blocked' AND NEW.status IN ('open','cancelled')) OR (OLD.status='open' AND NEW.status IN ('in_progress','waiting','cancelled')) OR (OLD.status='in_progress' AND NEW.status IN ('waiting','done','cancelled')) OR (OLD.status='waiting' AND NEW.status IN ('in_progress','cancelled'))) THEN RAISE EXCEPTION 'invalid work transition' USING ERRCODE='23000';END IF;
 IF OLD.status IN ('done','cancelled') THEN RAISE EXCEPTION 'closed work is immutable' USING ERRCODE='23000';END IF;
 IF OLD.breached_at IS NOT NULL AND NEW.breached_at IS DISTINCT FROM OLD.breached_at THEN RAISE EXCEPTION 'SLA breach history is immutable' USING ERRCODE='23000';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER work_item_guard BEFORE UPDATE ON collab.work_items FOR EACH ROW EXECUTE FUNCTION collab.guard_work_change();
CREATE FUNCTION collab.guard_handover_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.tenant_id,NEW.sender_membership_id,NEW.recipient_membership_id,NEW.note) IS DISTINCT FROM (OLD.tenant_id,OLD.sender_membership_id,OLD.recipient_membership_id,OLD.note) OR OLD.status<>'pending' OR NEW.status<>'acknowledged' THEN RAISE EXCEPTION 'handover is immutable except for acknowledgement' USING ERRCODE='23000';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER handover_guard BEFORE UPDATE ON collab.shift_handovers FOR EACH ROW EXECUTE FUNCTION collab.guard_handover_change();
