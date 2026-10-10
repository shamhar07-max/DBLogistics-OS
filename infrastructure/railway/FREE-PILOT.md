# Railway free pilot

Use branch `codex/railway-free-pilot` and Dockerfile `infrastructure/containers/railway-pilot.Dockerfile`. This is a limited pilot, not the full production stack. Railway Free currently permits five services, 512 MB RAM per service and $1 monthly usage credit. Running a database and identity server continuously can exceed that credit. No code change guarantees a permanently free, always-on system.

## Resources

One `runtime` service runs the API and staff dashboard. PostgreSQL is required. Use an existing compatible OIDC provider or a separate Keycloak service. The API validates JWT issuer and audience, and the database runtime role must not be superuser or BYPASSRLS. Do not use development authentication in production.

Redis, worker, ClamAV and object storage are omitted. Scheduled work, notification delivery, outbox processing, OCR and scanning do not run. Their outbox records may accumulate. Document upload intent and registration return 503; existing clean-document downloads still require configured storage. Workflows that require documents or asynchronous processing cannot complete in this mode. Review pending outbox jobs before enabling a worker later.

The partner portal is optional and increases memory use. Only enable it after checking Railway memory metrics. Heap limits bound JavaScript heaps, not total process memory; the combined process RSS can still exceed 512 MB. Leave the portal off first.

## Runtime variables

Set these privately in Railway (never commit credentials):

- `DATABASE_URL`: migrated PostgreSQL database using the least-privilege application role.
- `OIDC_ISSUER_URL`, `OIDC_AUDIENCE`: production identity issuer and API audience.
- `OIDC_WEB_CLIENT_ID`, `OIDC_WEB_CLIENT_SECRET`: staff confidential OIDC client.
- `SESSION_SECRET`: random secret of at least 32 characters.
- `OIDC_REDIRECT_URI`: `https://YOUR-STAFF-HOST/api/auth/callback`; register exactly this URI at the identity provider.
- `PUBLIC_API_URL`: staff HTTPS origin. The API is private behind the web BFF; there is no public direct API listener.

The image sets `NODE_ENV=production`, `RAILWAY_FREE_PILOT=true` and `DB_POOL_MAX=2`. The supervisor enforces pilot mode for every child. Railway supplies `PORT`. Do not override the start command. Use `/healthz` as the healthcheck path; it checks web listeners and API database readiness. Use restart on failure with a small retry limit and enable Serverless sleeping. There is no periodic worker or keep-alive in this runtime. PostgreSQL and an always-on identity server still consume resources while the runtime sleeps.

For the optional portal set `PORTAL_HOST` to its hostname without scheme/path/port, plus `PORTAL_OIDC_CLIENT_ID`, `PORTAL_OIDC_CLIENT_SECRET` and `PORTAL_SESSION_SECRET`. Register `https://PORTAL_HOST/api/auth/callback` for that client. Attach both hostnames to the same Railway service. Route by hostname; a path prefix is not supported. Keep Cloudflare SSL on Full (strict).

## First deployment

1. Run the existing `scripts/railway-bootstrap.ts` using the tooling Dockerfile and the variables described in README.md to create roles, migrate and provision the owner. The one-shot job exits. It can temporarily occupy a service slot; remove the completed bootstrap service when finished. Never give the runtime the admin database URL.
2. Deploy the pilot runtime and check `/healthz`, OIDC login and tenant selection.
3. Verify staff CRUD and tenant isolation. Verify uploads return 503 and the pilot notice appears.
4. Check combined memory under realistic requests before enabling the portal. This image was build-tested but has not been memory-certified on Railway.
5. Monitor monthly usage. Stop services before exhausting credit if a strictly zero-cost pilot is required. Railway's current plan details are authoritative: https://docs.railway.com/pricing/plans and https://docs.railway.com/pricing/free-trial .

To restore full operation, use the separate production Dockerfiles, configure Redis, worker, scanner and storage, and leave `RAILWAY_FREE_PILOT=false` on the API. Review retained asynchronous jobs before starting the worker. The normal production configuration is unchanged.
