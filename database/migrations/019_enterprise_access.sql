-- Access revocation is tenant-specific; role and membership changes are observed on every API request.
ALTER TABLE platform.memberships ADD COLUMN token_valid_after bigint;
ALTER TABLE platform.memberships ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE platform.memberships ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TRIGGER memberships_version BEFORE UPDATE ON platform.memberships FOR EACH ROW EXECUTE FUNCTION platform.bump_version();
ALTER TABLE org.branches ADD CONSTRAINT branches_entity_identity UNIQUE (tenant_id, legal_entity_id, id);
ALTER TABLE platform.membership_roles ADD CONSTRAINT role_branch_entity_fk FOREIGN KEY (tenant_id, legal_entity_id, branch_id) REFERENCES org.branches(tenant_id,legal_entity_id,id);
ALTER TABLE platform.membership_roles ADD CONSTRAINT role_branch_requires_entity CHECK (branch_id IS NULL OR legal_entity_id IS NOT NULL);
