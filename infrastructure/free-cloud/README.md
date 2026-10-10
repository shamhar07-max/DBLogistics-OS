# Portable free-cloud deployment

Run the application on an Oracle Always Free Ubuntu VM, expose selected services through Cloudflare Tunnel, and optionally use Supabase for application PostgreSQL and private document storage. The existing Railway deployment remains separate. This configuration is deployable preparation, not evidence that Oracle accounts, domains or Supabase resources have already been created.

## Choose a layout

| Component | Oracle + Cloudflare | Oracle + Cloudflare + Supabase |
|---|---|---|
| Staff dashboard, API, optional partner portal | Oracle Docker containers | Oracle Docker containers |
| Application PostgreSQL | Private Oracle container and volume | Supabase custom-role PostgreSQL connections |
| Login and identity database | Keycloak + private Oracle PostgreSQL | Same; Supabase Auth is not substituted |
| Queue, worker, malware scanning | Optional Oracle automation profile | Optional Oracle automation profile |
| Private documents | S3-compatible provider, including Supabase | Supabase S3 interface |
| Public HTTPS | Cloudflare named Tunnel | Cloudflare named Tunnel |

Start with Oracle-hosted PostgreSQL: it avoids Supabase's 500 MB database limit and requires fewer credentials. Choose the Supabase database overlay if you prefer managed application PostgreSQL and accept its limits. Both keep the API's PostgreSQL schemas, migrations, explicit tenant context and FORCE RLS. Do not expose these schemas through Supabase's Data API. Supabase's Auth users and JWTs are not the application's Keycloak identities.

## Free limits checked 10 October 2026

Oracle documents 1,500 A1 OCPU-hours and 9,000 GB-hours per month, equivalent to **2 OCPUs and 12 GB RAM**, with 200 GB combined boot/block storage. Provision only Always Free eligible resources in the home region. Capacity may be unavailable and idle instances may be reclaimed. Do not follow older tutorials promising 4 CPUs/24 GB. The 1 GB micro VMs cannot run this complete stack.

Supabase Free provides 500 MB database, 1 GB file storage, 5 GB egress and 5 GB cached egress, and may pause after one week of inactivity. Cloudflare Tunnel avoids publishing VM application ports. Domain registration, email delivery, WhatsApp, AI APIs, overages and paid add-ons are separate costs. These configurations cannot guarantee free availability or business continuity.

Sources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm · https://supabase.com/pricing · https://supabase.com/docs/guides/database/connecting-to-postgres · https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/get-started/create-remote-tunnel/

## One-time preparation

1. Create an Always Free eligible A1 Ubuntu VM within 2 CPUs/12 GB total and the home-region storage allowance. Install Git, Docker Engine and the Docker Compose plugin using their official Ubuntu instructions. Restrict SSH to your IP. No inbound HTTP, database, Redis or scanner port is required by this stack; Cloudflare Tunnel needs outbound connectivity (including Cloudflare port 7844). Do not create paid load balancers.
2. Clone branch `codex/free-cloud-deployment`. Generate configuration from the repository root:

   ```sh
   docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/repo" -w /repo node:22-bookworm-slim node scripts/configure-free-cloud.mjs
   ```

   Edit `infrastructure/free-cloud/.env`: set your staff, portal and identity HTTPS origins, owner email and tunnel token. The generator creates independent random passwords and refuses to overwrite an existing file. Keep the file private; never paste it into GitHub or screenshots. Existing database and identity passwords do not change when this file is edited.
3. Create a named Cloudflare Tunnel in the dashboard. Copy its token to `TUNNEL_TOKEN`. Add public hostnames:

   | Public hostname | Tunnel service |
   |---|---|
   | Staff hostname | `http://staff:3000` |
   | Identity hostname | `http://keycloak:8080` |
   | Portal hostname, after enabling portal | `http://portal:3002` |

   Keep the API private. Do not publish PostgreSQL, Redis, ClamAV or setup jobs. Avoid cache rules for authenticated HTML and `/api/*`. Use your own domains in both Cloudflare and `.env`; OIDC callback URIs must match exactly. Protect Keycloak administrative routes with a separate Cloudflare rule/Access policy without blocking public OIDC endpoints or required administrative setup.
4. If using Supabase storage, create a **private** bucket. Enable S3 and create S3 access credentials in Supabase Storage settings; a Supabase anon key is not an S3 credential. Set its endpoint, project region, bucket and access keys in `.env`. Keep `S3_FORCE_PATH_STYLE=true` and `S3_SERVER_SIDE_ENCRYPTION=none` for Supabase (the provider manages encryption at rest; AWS KMS request headers are not appropriate). Allow signed browser PUT/GET/HEAD requests from your actual staff/portal origins as supported by the provider. Test upload CORS. AWS S3 users can select `aws:kms` or `AES256`; virtual-host S3 providers can set path style false.

## Start with Oracle PostgreSQL

From the repository root:

```sh
bash infrastructure/free-cloud/deploy.sh
cd infrastructure/free-cloud
# Wait until https://YOUR-AUTH-HOST/realms/dbl returns its realm response.
docker compose --env-file .env -f compose.yaml run --rm owner-setup
docker compose --env-file .env -f compose.yaml up -d --wait api staff
```

`identity-setup` creates only the private Keycloak role/database. `database-setup` creates least-privilege application roles in the existing `dbl` database and applies immutable SQL migrations. `owner-setup` reads the actual OIDC subject from Keycloak and provisions the first tenant; it never guesses a UUID. It runs with the application role and refuses superuser/BYPASSRLS credentials. It is a first-tenant command: repeating it on an existing slug fails without creating another tenant. No setup job stays running.

Sign in at your staff hostname using `owner` (or OWNER_USERNAME) and OWNER_INITIAL_PASSWORD. Keycloak requires changing the temporary password. Later password resets belong in Keycloak's Users/Credentials screen; editing the environment variable does not reset imported users.

## Optional Supabase PostgreSQL

Use a fresh Supabase project or a carefully reviewed migration target. This does **not** automatically move the current Railway database. Retain the identity database and original Keycloak subjects during any data migration.

Set the four `SUPABASE_*_DATABASE_URL` variables. For persistent Docker services, use direct PostgreSQL if the VM has IPv6 connectivity, or the **session** pooler on port 5432 for IPv4. Use TLS with certificate verification (`sslmode=verify-full`). Do not use the transaction pooler (6543) for this deployment. Custom-role pooler usernames are `dbl_app.PROJECT_REF`, `dbl_worker.PROJECT_REF` and `dbl_migrator.PROJECT_REF`; copy the actual pooler hostname from the Supabase dashboard. The database normally stays `postgres`. Percent-encode passwords in URLs.

The admin session URL connects as `postgres.PROJECT_REF`; migrator/app/worker URLs use their separate passwords generated in `.env`. Setup creates these roles on the existing database, grants the migrator database/public-schema creation privileges, then applies the same migrations. It does not request superuser access or create a managed database. Existing custom roles keep their passwords: use their existing values if the project has been set up already. If your managed account refuses role or schema creation, fix those privileges through the Supabase SQL editor or use Oracle PostgreSQL; do not use the Supabase administrator or service_role as application credentials.

```sh
bash infrastructure/free-cloud/deploy.sh supabase
cd infrastructure/free-cloud
docker compose --env-file .env -f compose.yaml -f compose.supabase.yaml run --rm owner-setup
docker compose --env-file .env -f compose.yaml -f compose.supabase.yaml up -d --wait api staff
```

Keep the overlay on every subsequent Compose command. Keycloak still uses the local private database, so Supabase's connection budget is reserved for the application. Validate actual custom-role session pooling and extension/schema privileges on your Supabase project before accepting this profile. This managed-database path has not been live-tested against a Supabase project in this session.

## Portal, automation and document uploads

The default is a limited pilot (`RAILWAY_FREE_PILOT=true`), with uploads disabled and a visible notice. Oracle offers enough room to **attempt** the full profile, including the real worker and scanner:

```sh
# Add -f compose.supabase.yaml here too if you selected Supabase PostgreSQL.
docker compose --env-file .env -f compose.yaml --profile portal --profile automation up -d
```

Give ClamAV time to download signatures. Review `docker compose logs clamav worker`, confirm the scanner answers, test the private bucket and signed uploads in a non-production test configuration, and check clean-file and EICAR rejection. Missing/unreachable scanners must never mark documents clean. Only after acceptance, set `RAILWAY_FREE_PILOT=false` and recreate api/staff/portal with the same profile command. Before enabling the worker on an existing database, review retained outbox jobs and pending notifications; they can run immediately. SMTP/WhatsApp/AI integrations still need their provider credentials. The pilot notice disappears with pilot mode off; it does not certify every product feature or integration.

Monitor `docker stats` and disk use. Container memory caps total less than 12 GB, but image builds and the host also need memory. Builds are serialized by deploy.sh. All images must support the VM architecture; inspect the selected image manifests on the VM and pin tested version/digest values before operating a customer environment. Scanner signature updates can consume substantial disk and RAM.

## Verify and recover

- API health/readiness is checked inside Docker; staff OIDC login selects the owner's tenant automatically. Verify another user sees only their own memberships, never another tenant.
- Test staff/portal authorization, one enquiry-to-invoice flow, clean/malicious document scanning and delivery integrations actually configured for your deployment.
- Back up application PostgreSQL, Keycloak PostgreSQL and object bytes separately. Supabase Storage lacks S3 object versioning. Free tier is not a backup strategy.
- For local PostgreSQL, create a private backup directory and use `docker compose exec -T postgres pg_dump -U postgres -d dbl -Fc > backups/dbl.dump` and repeat for `keycloak`. Run from free-cloud, keep backups outside Git, and copy them off the VM. Test restores on a separate database. Never use `docker compose down -v` unless you intend to delete persistent data.
- For Supabase, export the application DB using pg_dump with its admin session URL and export Keycloak from the local container. Do not restore a Railway cluster-wide roles dump into a managed Supabase cluster; review schema ownership and application-role grants. Migration preserves existing subject/user/membership IDs, not only email addresses.
- Deploy code updates after a backup, run database-setup to apply new migrations, then rebuild/recreate applications. Do not rerun owner-setup on an existing tenant. Keep identity/client secret changes coordinated in Keycloak; realm import skips an existing realm.

These files passed Docker Compose config validation (including the Supabase overlay), configuration consistency checks and application builds. Docker is unavailable in the authoring environment; ARM image builds, Tunnel routing, Supabase role setup, live storage/scanning, backups and restoration remain acceptance steps on your actual accounts.
