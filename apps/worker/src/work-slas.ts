import type pg from 'pg';
import { inTenant } from './db';
/** Each breach and its audit/outbox records commit together. Concurrent timers skip locked rows. */
export async function recordWorkBreaches(pool:pg.Pool):Promise<number> {
 const tenants=(await pool.query(`SELECT id FROM platform.tenants WHERE status='active'`)).rows;let count=0;
 for(const t of tenants)count+=await inTenant(pool,t.id,async tx=>{
  const rows=await tx.q(`SELECT id,department,assignee_membership_id,due_at FROM collab.work_items WHERE status IN ('open','in_progress') AND due_at<now() AND breached_at IS NULL ORDER BY id LIMIT 200 FOR UPDATE SKIP LOCKED`);
  for(const r of rows){await tx.q(`UPDATE collab.work_items SET breached_at=now() WHERE id=$1`,[r.id]);
   await tx.q(`INSERT INTO platform.audit_events(tenant_id,actor_kind,request_id,action,entity_type,entity_id,detail) VALUES($1,'system','sla-timer','work.sla-breached','work_item',$2,$3::jsonb)`,[t.id,r.id,JSON.stringify({dueAt:r.due_at})]);
   await tx.q(`INSERT INTO platform.outbox(tenant_id,topic,aggregate_type,aggregate_id,payload,correlation_id) VALUES($1,'WorkSlaBreached','work_item',$2,$3::jsonb,'sla-timer')`,[t.id,r.id,JSON.stringify({department:r.department,assigneeMembershipId:r.assignee_membership_id})]);
  }return rows.length;
 });return count;
}
