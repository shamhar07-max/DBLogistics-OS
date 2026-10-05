-- Run ONCE per cluster as a superuser. Separates migration credentials from runtime credentials.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dbl_migrator') THEN
    CREATE ROLE dbl_migrator LOGIN PASSWORD 'dbl_migrator_dev' NOSUPERUSER NOBYPASSRLS CREATEROLE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dbl_app') THEN
    CREATE ROLE dbl_app LOGIN PASSWORD 'dbl_app_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='dbl_worker') THEN
    CREATE ROLE dbl_worker LOGIN PASSWORD 'dbl_worker_dev' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;
