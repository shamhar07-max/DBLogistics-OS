-- DigitalBurj Business Hub (business.digitalburj.com): companies, users, sessions, audit. Every row of company data carries tenant_id.
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, sector INTEGER NOT NULL DEFAULT 1, legal_name TEXT NOT NULL, trade_name TEXT, trade_license TEXT NOT NULL, license_authority TEXT NOT NULL,
  trn TEXT, business_type TEXT NOT NULL, country TEXT NOT NULL, city TEXT NOT NULL, address TEXT NOT NULL, phone TEXT NOT NULL, email TEXT, website TEXT, staff_size TEXT,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id), email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, job_title TEXT, phone TEXT,
  role TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', must_change INTEGER NOT NULL DEFAULT 0,
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL, created_at TEXT NOT NULL, last_login_at TEXT, created_by TEXT
);
CREATE INDEX IF NOT EXISTS users_tenant ON users(tenant_id);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, absolute_expires_at INTEGER NOT NULL, ip TEXT, ua TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS throttle (k TEXT PRIMARY KEY, n INTEGER NOT NULL, window_start INTEGER NOT NULL, locked_until INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, user_id TEXT, action TEXT NOT NULL, detail TEXT, ip TEXT, at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_tenant ON audit(tenant_id, id DESC);
