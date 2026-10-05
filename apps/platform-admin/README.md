# Platform admin (control plane)

**Status: not built.** Tenant provisioning exists as a tested use case (`apps/api/src/provisioning.ts`, used by the dev seed and the test-suite). A control-plane UI (tenants, subscriptions, feature activation, integration health, AI cost, failed jobs, backup health) needs a *platform-level* identity separate from tenant memberships and a dedicated database role — see `specifications/architecture/status.md`.
