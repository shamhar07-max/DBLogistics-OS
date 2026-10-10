-- Login has a verified user context but no selected tenant yet.
-- The migration role is deliberately subject to FORCE RLS, so a SECURITY
-- DEFINER lookup owned by that role cannot see the caller's memberships.
ALTER FUNCTION platform.my_memberships() SECURITY INVOKER;
CREATE POLICY member_tenant_lookup ON platform.tenants FOR SELECT TO dbl_app
USING (EXISTS (
  SELECT 1 FROM platform.memberships m
  WHERE m.tenant_id = platform.tenants.id
    AND m.user_id = platform.current_user_id()
    AND m.status = 'active'
));
