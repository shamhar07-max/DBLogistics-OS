# Railway hosting with Cloudflare DNS and proxy

This is deployment preparation, not proof of production acceptance. Use an empty staging project first. Railway resource charges apply; the free allowance is unlikely to cover this complete stack.

## Services

Connect every application service to this repository and the deployment branch. Keep Root Directory `/` so npm workspaces and brand assets are available. Set each service's Config File Path to the matching absolute path below.

| Service | Config File Path | Public port |
|---|---|---|
| api | /infrastructure/railway/api.json | PORT=3001 |
| worker | /infrastructure/railway/worker.json | none |
| staff-web | /infrastructure/railway/staff-web.json | PORT=3000 |
| partner-portal | /infrastructure/railway/partner-portal.json | PORT=3002 |
| bootstrap | /infrastructure/railway/tooling.json | none |
| keycloak | /infrastructure/railway/keycloak.json | PORT=8080 |

Create PostgreSQL 16 and Redis 7 services with persistent volumes. Deploy ClamAV using `clamav/clamav:stable`, private port 3310, persistent volume `/var/lib/clamav`; allow time for signature downloads. Do not give PostgreSQL, Redis, ClamAV, worker or bootstrap public domains. Disable sleeping for worker and supporting infrastructure.

## Bootstrap before starting applications

Generate independent random passwords locally, e.g. `openssl rand -hex 32`; enter them only in Railway service variables. Never commit real values. Configure bootstrap:

- ADMIN_DATABASE_URL: PostgreSQL's private administrator URL.
- PGHOST_PRIVATE / PGPORT_PRIVATE: PostgreSQL private hostname / 5432.
- DBL_MIGRATOR_PASSWORD, DBL_APP_PASSWORD, DBL_WORKER_PASSWORD, KC_DB_PASSWORD.
- TENANT_SLUG, TENANT_NAME, TENANT_CURRENCY=AED.
- OWNER_SUBJECT: a generated UUID, identical in Keycloak; OWNER_EMAIL: actual owner email.

Run bootstrap and require `bootstrap complete` in logs. It creates least-privilege roles, `dbl` and `keycloak` databases, pgcrypto, migrations and the owner membership. Disable/remove the bootstrap service after success and remove its administrator credential. Future migrations should run under the migrator role through the tooling image with start command `npx tsx database/migrate.ts` and MIGRATION_DATABASE_URL. Do not point runtime applications at the administrator URL.

## Application variables

Replace hostnames with actual Railway private domains, not Docker Compose names. URL-encode passwords in PostgreSQL URLs.

API:

- NODE_ENV=production, PORT=3001
- DATABASE_URL=postgres://dbl_app:<encoded-password>@<postgres-private-host>:5432/dbl
- OIDC_ISSUER_URL=https://auth.digitalburj.com/realms/dbl, OIDC_AUDIENCE=dbl-api
- CORS_ORIGINS=https://logistics.digitalburj.com,https://portal.digitalburj.com
- Document storage variables below. DEV_AUTH_SECRET must be absent.

Worker:

- NODE_ENV=production
- WORKER_DATABASE_URL=postgres://dbl_worker:<encoded-password>@<postgres-private-host>:5432/dbl
- REDIS_URL: private Redis URL (include its authentication).
- CLAMD_HOST: ClamAV private hostname; CLAMD_PORT=3310; OCR_LANGS=eng+ara
- PORTAL_BASE_URL=https://portal.digitalburj.com
- SMTP_URL, SMTP_FROM: your real email relay. Without these, email delivery is not configured.
- Optional WHATSAPP_TOKEN / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_TEMPLATE_LANG: requires Meta onboarding and approved templates.
- Same storage variables as API. Keep scanner enabled: unavailable ClamAV leaves documents unapproved.

Both Next.js services:

- NODE_ENV=production; PORT as above.
- API_BASE_URL=http://<api-private-host>:3001 (do not append /api/v1; gateway adds it).
- SESSION_SECRET: independent random value per service, at least 32 characters.
- OIDC_ISSUER_URL=https://auth.digitalburj.com/realms/dbl
- Staff: OIDC_WEB_CLIENT_ID=dbl-staff-web; OIDC_WEB_CLIENT_SECRET matches KC_STAFF_CLIENT_SECRET; OIDC_REDIRECT_URI=https://logistics.digitalburj.com/api/auth/callback.
- Portal: OIDC_WEB_CLIENT_ID=dbl-partner-portal; OIDC_WEB_CLIENT_SECRET matches KC_PORTAL_CLIENT_SECRET; OIDC_REDIRECT_URI=https://portal.digitalburj.com/api/auth/callback.
- DEV_AUTH_SECRET must be absent. All listed variables are server-only, never NEXT_PUBLIC_.

## Keycloak

Set KC_DB=postgres, KC_DB_URL=jdbc:postgresql://<postgres-private-host>:5432/keycloak, KC_DB_USERNAME=keycloak, KC_DB_PASSWORD; KC_HTTP_ENABLED=true, KC_HTTP_PORT=8080, KC_PROXY_HEADERS=xforwarded, KC_HOSTNAME=https://auth.digitalburj.com. Set unique KC_BOOTSTRAP_ADMIN_USERNAME / KC_BOOTSTRAP_ADMIN_PASSWORD in Railway.

The realm import uses environment substitutions. Set STAFF_URL=https://logistics.digitalburj.com, PORTAL_URL=https://portal.digitalburj.com, KC_STAFF_CLIENT_SECRET, KC_PORTAL_CLIENT_SECRET, OWNER_SUBJECT (same bootstrap UUID), OWNER_USERNAME, OWNER_EMAIL and OWNER_INITIAL_PASSWORD. The owner changes the temporary password at first login. Import only runs for a new realm; subsequent URL/client-secret changes must be applied in the Keycloak admin console. Protect admin access separately; application users must not be realm administrators.

## Private document storage

Use an S3-compatible bucket such as Cloudflare R2. API and worker both need DOCUMENT_BUCKET, S3_ENDPOINT (provider HTTPS endpoint), AWS_REGION (`auto` for R2), AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY. Restrict credentials to the document bucket. Keep the bucket private; do not enable a public r2.dev domain.

Configure bucket CORS for the staff and portal origins with GET, PUT and HEAD, allowed Content-Type headers and exposed ETag. Browser uploads use signed URLs, so storage must have an externally reachable HTTPS endpoint. Test signed upload, scan, preview and download before accepting real documents. Storage activation and usage may have separate billing requirements.

## Cloudflare

Create Railway custom domains for staff (`logistics.digitalburj.com`), portal (`portal.digitalburj.com`) and Keycloak (`auth.digitalburj.com`). API can remain private unless provider webhooks require a public endpoint, in which case add `api-logistics.digitalburj.com`.

Copy the exact CNAME and verification TXT records Railway provides into Cloudflare. Start DNS-only until Railway issues certificates. Then enable proxy and use Full (strict), never Flexible. Keep existing website and email records unchanged. Bypass caching on authenticated application and login hostnames; never use Cache Everything on their HTML or /api routes. Apply bot challenges selectively so callbacks, signed uploads and provider webhooks are not interrupted. The API uses private networking for dashboard requests; public webhooks must verify signatures.

## Acceptance and operations

1. API /api/v1/health and /api/v1/health/ready return 200.
2. Staff and portal serve pages, production OIDC login succeeds, and callback URLs match exactly.
3. Owner enters the bootstrap tenant id; test another user cannot access that tenant without membership.
4. Create an enquiry, approve a quote, open a job, invoice and record a payment.
5. Upload a test document, wait for scanning, then preview and download; test malicious files are refused.
6. Verify worker processing and email delivery; monitor failure logs.
7. Restart applications and verify database, documents, Redis queues and identity survive.
8. Configure database backups and test restoration outside the live database. Configure private storage retention/version recovery as supported by the provider.
9. Set Railway spending alerts/limits deliberately; stopping at a cap can interrupt operations. Measure actual pilot usage before promising a monthly price.

Docker is unavailable in the preparation environment: images and cloud networking still require Railway builds and live acceptance. Repository status.md also lists unfinished product features independently of hosting.

Official references: https://docs.railway.com/builds/dockerfiles · https://docs.railway.com/networking/domains/working-with-domains · https://docs.railway.com/pricing/plans
