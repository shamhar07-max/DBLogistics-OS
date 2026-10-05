-- 009 Identity support: users can list their OWN memberships (incl. tenant names) without any cross-tenant read.
CREATE FUNCTION platform.my_memberships() RETURNS TABLE (tenant_id uuid, tenant_name text, slug text, workspace text, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = platform, pg_temp AS $$
  SELECT m.tenant_id, t.name, t.slug, m.workspace, m.status FROM platform.memberships m JOIN platform.tenants t ON t.id = m.tenant_id
  WHERE m.user_id = platform.current_user_id() AND m.status = 'active' $$;
REVOKE ALL ON FUNCTION platform.my_memberships() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION platform.my_memberships() TO dbl_app;

ALTER TABLE finance.invoices ADD COLUMN drafted_by uuid;
ALTER TABLE finance.accounts ADD CONSTRAINT accounts_system_key_known CHECK (system_key IS NULL OR system_key IN ('AR','AP','BANK','REVENUE','COST','ACCRUED_COST','VAT_OUT','VAT_IN','ADVANCES'));

-- Tenant provisioning use case (platform-admin): creates tenant, roles from templates are inserted by the application.
