import {beforeAll,afterAll,it,expect} from 'vitest';
import pg from 'pg';
import {migrate} from '../../../database/migrate';
import {makePool} from '../src/db';
import {recordWorkBreaches} from '../src/work-slas';
let su:pg.Pool,pool:pg.Pool,item:string,tenant:string;
beforeAll(async()=>{
 const a=new pg.Client({connectionString:'postgres://postgres@localhost:54329/postgres'});await a.connect();await a.query('DROP DATABASE IF EXISTS dbl_sla_test WITH (FORCE)');await a.query('CREATE DATABASE dbl_sla_test OWNER dbl_migrator');await a.end();
 const pre=new pg.Client({connectionString:'postgres://postgres@localhost:54329/dbl_sla_test'});await pre.connect();await pre.query('CREATE EXTENSION pgcrypto');await pre.end();await migrate('postgres://dbl_migrator:dbl_migrator_dev@localhost:54329/dbl_sla_test');
 su=new pg.Pool({connectionString:'postgres://postgres@localhost:54329/dbl_sla_test'});pool=makePool('postgres://dbl_worker:dbl_worker_dev@localhost:54329/dbl_sla_test');
 tenant=(await su.query(`INSERT INTO platform.tenants(slug,name) VALUES('sla-test','SLA test') RETURNING id`)).rows[0].id;const user=(await su.query(`INSERT INTO platform.users(subject) VALUES('sla-test') RETURNING id`)).rows[0].id;const member=(await su.query(`INSERT INTO platform.memberships(tenant_id,user_id) VALUES($1,$2) RETURNING id`,[tenant,user])).rows[0].id;const entity=(await su.query(`INSERT INTO org.legal_entities(tenant_id,name,base_currency) VALUES($1,'SLA entity','AED') RETURNING id`,[tenant])).rows[0].id;const calendar=(await su.query(`INSERT INTO collab.work_calendars(tenant_id,key,name,version,calendar,created_by) VALUES($1,'test','Test',1,'{}',$2) RETURNING id`,[tenant,member])).rows[0].id;
 item=(await su.query(`INSERT INTO collab.work_items(tenant_id,legal_entity_id,title,description,department,complexity,created_by,calendar_id,sla_seconds,remaining_seconds,due_at) VALUES($1,$2,'Review','Review evidence','Operations',1,$3,$4,60,60,now()-interval '1 minute') RETURNING id`,[tenant,entity,member,calendar])).rows[0].id;
});
afterAll(async()=>{await pool?.end();await su?.end();});
it('racing worker SLA timers commit one breach and cannot mutate business status',async()=>{
 const results=await Promise.all([recordWorkBreaches(pool),recordWorkBreaches(pool)]);expect(results.reduce((a,b)=>a+b,0)).toBe(1);expect(await recordWorkBreaches(pool)).toBe(0);
 expect((await su.query(`SELECT count(*)::int n FROM platform.outbox WHERE tenant_id=$1 AND topic='WorkSlaBreached'`,[tenant])).rows[0].n).toBe(1);expect((await su.query(`SELECT count(*)::int n FROM platform.audit_events WHERE entity_id=$1 AND action='work.sla-breached'`,[item])).rows[0].n).toBe(1);
 await expect(pool.query(`UPDATE collab.work_items SET status='done' WHERE id=$1`,[item])).rejects.toThrow(/permission denied/);
});
