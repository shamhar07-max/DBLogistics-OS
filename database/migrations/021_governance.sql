CREATE TABLE collab.knowledge_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,legal_entity_id uuid NOT NULL,branch_id uuid,key text NOT NULL,title text NOT NULL,category text NOT NULL CHECK(category IN ('sop','policy','manual','customer_sop','carrier_instruction','customs_guide','training')),
 revision int NOT NULL,content text NOT NULL,content_sha256 text GENERATED ALWAYS AS (encode(digest(content,'sha256'),'hex')) STORED,change_note text NOT NULL,status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published')),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),published_by uuid,published_at timestamptz,review_note text,
 UNIQUE(tenant_id,id),UNIQUE NULLS NOT DISTINCT(tenant_id,legal_entity_id,branch_id,key,revision),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES org.legal_entities(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id,branch_id) REFERENCES org.branches(tenant_id,legal_entity_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,published_by) REFERENCES platform.memberships(tenant_id,id),CHECK(published_by IS NULL OR published_by<>created_by),CHECK((status='published')=(published_at IS NOT NULL))
);
CREATE FUNCTION collab.guard_knowledge_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.status='published' THEN RAISE EXCEPTION 'knowledge revision is immutable' USING ERRCODE='23000';END IF;
 IF (NEW.tenant_id,NEW.legal_entity_id,NEW.branch_id,NEW.key,NEW.title,NEW.category,NEW.revision,NEW.content,NEW.change_note,NEW.created_by) IS DISTINCT FROM (OLD.tenant_id,OLD.legal_entity_id,OLD.branch_id,OLD.key,OLD.title,OLD.category,OLD.revision,OLD.content,OLD.change_note,OLD.created_by) OR NEW.status<>'published' THEN RAISE EXCEPTION 'knowledge revision can only be published' USING ERRCODE='23000';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER knowledge_immutable BEFORE UPDATE OR DELETE ON collab.knowledge_revisions FOR EACH ROW EXECUTE FUNCTION collab.guard_knowledge_revision();
CREATE TABLE collab.knowledge_acknowledgements (
 tenant_id uuid NOT NULL,revision_id uuid NOT NULL,membership_id uuid NOT NULL,acknowledged_at timestamptz NOT NULL DEFAULT now(),content_sha256 text NOT NULL,
 PRIMARY KEY(tenant_id,revision_id,membership_id),FOREIGN KEY(tenant_id,revision_id) REFERENCES collab.knowledge_revisions(tenant_id,id),FOREIGN KEY(tenant_id,membership_id) REFERENCES platform.memberships(tenant_id,id)
);
CREATE TRIGGER knowledge_ack_immutable BEFORE UPDATE OR DELETE ON collab.knowledge_acknowledgements FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
CREATE TABLE collab.risks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,legal_entity_id uuid NOT NULL,branch_id uuid,title text NOT NULL,category text NOT NULL CHECK(category IN ('financial','operational','customer','carrier','compliance','security','legal')),description text NOT NULL,
 likelihood int NOT NULL CHECK(likelihood BETWEEN 1 AND 5),impact int NOT NULL CHECK(impact BETWEEN 1 AND 5),inherent_score int GENERATED ALWAYS AS(likelihood*impact) STORED,
 residual_likelihood int NOT NULL CHECK(residual_likelihood BETWEEN 1 AND 5),residual_impact int NOT NULL CHECK(residual_impact BETWEEN 1 AND 5),residual_score int GENERATED ALWAYS AS(residual_likelihood*residual_impact) STORED,
 mitigation text NOT NULL,owner_membership_id uuid NOT NULL,next_review_on date NOT NULL,status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','mitigating','closed')),created_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),version int NOT NULL DEFAULT 1,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id) REFERENCES org.legal_entities(tenant_id,id),FOREIGN KEY(tenant_id,legal_entity_id,branch_id) REFERENCES org.branches(tenant_id,legal_entity_id,id),FOREIGN KEY(tenant_id,owner_membership_id) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,created_by) REFERENCES platform.memberships(tenant_id,id)
);
CREATE TRIGGER risk_version BEFORE UPDATE ON collab.risks FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
CREATE TABLE collab.risk_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,risk_id uuid NOT NULL,reviewed_by uuid NOT NULL,reviewed_at timestamptz NOT NULL DEFAULT now(),outcome text NOT NULL,review_note text NOT NULL,mitigation text NOT NULL,residual_likelihood int NOT NULL,residual_impact int NOT NULL,next_review_on date NOT NULL,evidence_document_id uuid,
 UNIQUE(tenant_id,id),FOREIGN KEY(tenant_id,risk_id) REFERENCES collab.risks(tenant_id,id),FOREIGN KEY(tenant_id,reviewed_by) REFERENCES platform.memberships(tenant_id,id),FOREIGN KEY(tenant_id,evidence_document_id) REFERENCES platform.documents(tenant_id,id)
);
CREATE TRIGGER risk_reviews_immutable BEFORE UPDATE OR DELETE ON collab.risk_reviews FOR EACH ROW EXECUTE FUNCTION platform.deny_mutation();
SELECT platform.enforce_rls('collab','knowledge_revisions');SELECT platform.enforce_rls('collab','knowledge_acknowledgements');SELECT platform.enforce_rls('collab','risks');SELECT platform.enforce_rls('collab','risk_reviews');
GRANT SELECT,INSERT,UPDATE ON collab.knowledge_revisions,collab.risks TO dbl_app;GRANT SELECT,INSERT ON collab.knowledge_acknowledgements,collab.risk_reviews TO dbl_app;
ALTER TABLE collab.knowledge_revisions ADD CONSTRAINT knowledge_publisher_required CHECK((status='published')=(published_by IS NOT NULL) AND(status<>'published' OR review_note IS NOT NULL));
CREATE FUNCTION collab.guard_knowledge_ack() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM collab.knowledge_revisions k WHERE k.tenant_id=NEW.tenant_id AND k.id=NEW.revision_id AND k.status='published' AND k.content_sha256=NEW.content_sha256) THEN RAISE EXCEPTION 'acknowledgement requires a published revision and its content hash' USING ERRCODE='23000';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER knowledge_ack_guard BEFORE INSERT ON collab.knowledge_acknowledgements FOR EACH ROW EXECUTE FUNCTION collab.guard_knowledge_ack();
CREATE FUNCTION collab.guard_risk_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='closed' OR(NEW.tenant_id,NEW.legal_entity_id,NEW.branch_id,NEW.title,NEW.category,NEW.description,NEW.likelihood,NEW.impact,NEW.owner_membership_id,NEW.created_by) IS DISTINCT FROM(OLD.tenant_id,OLD.legal_entity_id,OLD.branch_id,OLD.title,OLD.category,OLD.description,OLD.likelihood,OLD.impact,OLD.owner_membership_id,OLD.created_by) THEN RAISE EXCEPTION 'original risk definition and closed risks are immutable' USING ERRCODE='23000';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER risk_guard BEFORE UPDATE ON collab.risks FOR EACH ROW EXECUTE FUNCTION collab.guard_risk_change();
