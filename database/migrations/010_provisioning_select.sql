-- 010 Tenant provisioning must read back the row it just created (INSERT ... RETURNING).
-- Only visible while the explicit, transaction-local provisioning flag is on (set by the platform-admin use case only).
CREATE POLICY provision_select ON platform.tenants FOR SELECT TO dbl_app USING (current_setting('app.provisioning', true) = 'on');
