import pg from 'pg';
import { migrate } from '../database/migrate';
import { provisionTenant } from '../apps/api/src/provisioning';
const need = (key: string) => { const value=process.env[key]; if (!value) throw new Error(`${key} is required`); return value; };
const quote = (value: string) => `'${value.replace(/'/g,"''")}'`;
async function main() {
  const mode=process.argv[2];
  if (mode==='database' || mode==='identity-database') {
    const db=new pg.Client({connectionString:need('ADMIN_DATABASE_URL')}); await db.connect();
    try {
      const roles=mode==='database' ? [['dbl_migrator','DBL_MIGRATOR_PASSWORD'],['dbl_app','DBL_APP_PASSWORD'],['dbl_worker','DBL_WORKER_PASSWORD']] : [['keycloak','KC_DB_PASSWORD']];
      for (const [name,key] of roles) {
        const old=(await db.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=$1',[name])).rows[0];
        if (old?.rolsuper || old?.rolbypassrls) throw new Error(`Unsafe existing role ${name}`);
        if (!old) await db.query(`CREATE ROLE ${name} LOGIN PASSWORD ${quote(need(key))} NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`);
      }
      if(mode==='database') {
        const database=(await db.query('SELECT current_database() AS name')).rows[0].name;
        await db.query(`GRANT CREATE, CONNECT ON DATABASE "${database.replace(/"/g,'""')}" TO dbl_migrator`);
        await db.query('GRANT USAGE, CREATE ON SCHEMA public TO dbl_migrator');
        await db.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      } else if (!(await db.query("SELECT 1 FROM pg_database WHERE datname='keycloak'")).rowCount) await db.query('CREATE DATABASE keycloak OWNER keycloak');
    } finally {await db.end();}
    if(mode==='database') console.log('Migrations:',(await migrate(need('MIGRATION_DATABASE_URL'))).join(', ')||'up to date');
  } else if(mode==='owner') {
    const base=need('IDENTITY_URL').replace(/\/$/,'');
    const response=await fetch(`${base}/realms/master/protocol/openid-connect/token`,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'password',client_id:'admin-cli',username:need('KC_BOOTSTRAP_ADMIN_USERNAME'),password:need('KC_BOOTSTRAP_ADMIN_PASSWORD')}),signal:AbortSignal.timeout(15000)});
    if(!response.ok) throw new Error('Identity administrator login failed');
    const token=await response.json() as {access_token:string};
    const result=await fetch(`${base}/admin/realms/dbl/users?username=${encodeURIComponent(need('OWNER_USERNAME'))}&exact=true`,{headers:{Authorization:`Bearer ${token.access_token}`},signal:AbortSignal.timeout(15000)});
    if(!result.ok) throw new Error('Identity owner lookup failed');
    const users=await result.json() as {id:string;username:string;email?:string;enabled:boolean}[];
    if(users.length!==1 || !users[0].enabled) throw new Error('Expected one enabled owner identity');
    const pool=new pg.Pool({connectionString:need('APP_DATABASE_URL'),max:1});
    try {
      const role=(await pool.query('SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if(role.rolsuper || role.rolbypassrls) throw new Error('Owner provisioning requires the application role');
      console.log('Provisioned:',await provisionTenant(pool,{slug:need('TENANT_SLUG'),name:need('TENANT_NAME'),ownerSubject:users[0].id,ownerEmail:users[0].email,currency:'AED'}));
    } finally {await pool.end();}
  } else throw new Error('Mode must be database, identity-database or owner');
}
main().catch(error=>{console.error(error instanceof Error ? error.message : 'Setup failed');process.exit(1);});
