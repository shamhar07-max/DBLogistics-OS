import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {randomUUID} from 'node:crypto';
import {world,close,makeParty,type World,type Client} from './helpers';
let w:World,staff:Client,receiver:Client,staffId:string,receiverId:string,calendar:string;
const base=()=>({legalEntityId:w.a.legalEntityId,branchId:null,title:'Prepare shipping documentation',description:'Review draft and verify required source evidence',department:'Documentation',calendarId:calendar,slaMinutes:120,complexity:4,assigneeMembershipId:staffId});
const cmd=(c:Client,id:string,action:string,version?:number)=>c.cmd(`/work/items/${id}/transition`,{action,note:'Reviewed this work and recorded the action'},randomUUID(),version?{'If-Match':String(version)}:{});
beforeAll(async()=>{w=await world();staff=await w.member(w.a.tenantId,'work-staff',['freight_ops']);receiver=await w.member(w.a.tenantId,'work-receiver',['freight_ops']);staffId=(await staff.get('/me')).body.membershipId;receiverId=(await receiver.get('/me')).body.membershipId;const c=await w.owner.cmd('/work/calendars',{key:'always',name:'Always available',calendar:{timezone:'Asia/Dubai',weekdays:[1,2,3,4,5,6,7],startMinute:0,endMinute:1440,holidays:[]}});expect(c.status).toBe(201);calendar=c.body.id;});
afterAll(async()=>close(w));
describe('enterprise work controls',()=>{
 it('validates calendar/template versions and freezes definitions',async()=>{
  expect((await staff.cmd('/work/calendars',{key:'x1',name:'Bad',calendar:{timezone:'No/Zone',weekdays:[1],startMinute:600,endMinute:500}})).status).toBe(403);
  expect((await w.owner.cmd('/work/calendars',{key:'bad',name:'Bad',calendar:{timezone:'No/Zone',weekdays:[1],startMinute:600,endMinute:500}})).status).toBe(422);
  const body={legalEntityId:w.a.legalEntityId,branchId:null,key:'export',name:'Export document control',calendarId:calendar,steps:[{key:'review',title:'Review evidence',department:'Documentation',slaMinutes:120,complexity:2,dependsOn:[]},{key:'release',title:'Release document',department:'Documentation',slaMinutes:60,complexity:1,dependsOn:['review']}]};
  expect((await w.owner.cmd('/work/templates',{...body,steps:[{...body.steps[0],dependsOn:['release']}]})).status).toBe(422);
  const [a,b]=await Promise.all([w.owner.cmd('/work/templates',body),w.owner.cmd('/work/templates',body)]);expect([a.body.version,b.body.version].sort()).toEqual([1,2]);
  await expect(w.su.query(`UPDATE collab.work_templates SET name='tamper' WHERE id=$1`,[a.body.id])).rejects.toThrow(/append-only/);
  const key=randomUUID();const [x,y]=await Promise.all([staff.cmd('/work/instances',{templateId:a.body.id,title:'Shipment source check',assigneeMembershipId:staffId},key),staff.cmd('/work/instances',{templateId:a.body.id,title:'Shipment source check',assigneeMembershipId:staffId},key)]);expect(x.status).toBe(201);expect(y.body).toEqual(x.body);
  const [first,next]=x.body.items;expect(next.status).toBe('blocked');expect((await cmd(staff,next.id,'start')).status).toBe(409);await cmd(staff,first.id,'start');expect((await cmd(staff,first.id,'complete')).status).toBe(200);const unlocked=await staff.get(`/work/items/${next.id}`);expect(unlocked.body.status).toBe('open');expect(unlocked.body.due_at).toBeTruthy();
 });
 it('persists pause/resume time, rejects stale actions and closed-work mutations',async()=>{
  const r=(await staff.cmd('/work/items',base())).body;expect(r.remaining_seconds).toBe('7200');expect((await cmd(staff,r.id,'complete')).status).toBe(409);
  const started=(await cmd(staff,r.id,'start',1)).body;expect(started.status).toBe('in_progress');expect((await cmd(staff,r.id,'pause',1)).body.code).toBe('VERSION_CONFLICT');
  const paused=(await cmd(staff,r.id,'pause',started.version)).body;expect(paused.status).toBe('waiting');expect(paused.due_at).toBeNull();expect(Number(paused.remaining_seconds)).toBeLessThanOrEqual(7200);
  const resumed=(await cmd(staff,r.id,'resume',paused.version)).body;expect(resumed.status).toBe('in_progress');expect(resumed.due_at).toBeTruthy();await cmd(staff,r.id,'complete',resumed.version);
  expect((await cmd(staff,r.id,'start')).status).toBe(409);await expect(w.su.query(`UPDATE collab.work_items SET title='tamper' WHERE id=$1`,[r.id])).rejects.toThrow(/immutable/);
 });
 it('records each overdue breach once under concurrent API checks',async()=>{
  const r=(await staff.cmd('/work/items',base())).body;await w.su.query(`UPDATE collab.work_items SET due_at=now()-interval '1 minute' WHERE id=$1`,[r.id]);
  const results=await Promise.all([staff.cmd('/work/check-slas'),staff.cmd('/work/check-slas')]);expect(results.every(r=>r.status===200)).toBe(true);expect((await staff.get(`/work/items/${r.id}`)).body.breached_at).toBeTruthy();expect((await w.su.query(`SELECT count(*)::int n FROM platform.outbox WHERE aggregate_id=$1 AND topic='WorkSlaBreached'`,[r.id])).rows[0].n).toBe(1);
 });
 it('calculates workload without counting closed items or using floating-point assignment heuristics',async()=>{
  expect((await w.owner.cmd('/work/capacity',{legalEntityId:w.a.legalEntityId,branchId:null,membershipId:receiverId,department:'Documentation',capacityPoints:10,available:true})).status).toBe(200);
  const r=await staff.cmd('/work/items',{...base(),assigneeMembershipId:receiverId});expect(r.status).toBe(201);const rows=(await staff.get('/work/workload')).body;const row=rows.find((r:any)=>r.membership_id===receiverId);expect(row.assigned_points).toBe(4);expect(row.utilization_percent).toBe('40.0');
 });
 it('requires the named recipient and atomically transfers unchanged work on acknowledgement',async()=>{
  const r=(await staff.cmd('/work/items',base())).body;const h=(await staff.cmd('/work/handovers',{recipientMembershipId:receiverId,itemIds:[r.id],note:'Draft reviewed; confirm remaining source documents'})).body;expect(h.id).toBeTruthy();expect((await staff.cmd(`/work/handovers/${h.id}/acknowledge`,{note:'I accept this outstanding work'})).status).toBe(404);
  expect((await w.owner.get('/work/handovers')).body).not.toContainEqual(expect.objectContaining({id:h.id}));const key=randomUUID();const a=await receiver.cmd(`/work/handovers/${h.id}/acknowledge`,{note:'I accept this outstanding work'},key,{'If-Match':'1'});expect(a.status).toBe(200);expect((await receiver.cmd(`/work/handovers/${h.id}/acknowledge`,{note:'I accept this outstanding work'},key)).body).toEqual(a.body);expect((await receiver.get(`/work/items/${r.id}`)).body.assignee_membership_id).toBe(receiverId);
  const changed=(await staff.cmd('/work/items',base())).body;const old=(await staff.cmd('/work/handovers',{recipientMembershipId:receiverId,itemIds:[changed.id],note:'Check status before taking this assignment'})).body;await cmd(staff,changed.id,'start');expect((await receiver.cmd(`/work/handovers/${old.id}/acknowledge`,{note:'I accept this outstanding work'})).body.code).toBe('VERSION_CONFLICT');expect((await staff.get(`/work/items/${changed.id}`)).body.assignee_membership_id).toBe(staffId);
 });
 it('filters entity/branch scopes and prevents external/foreign assignees and handovers',async()=>{
  const branch=(await w.su.query(`INSERT INTO org.branches(tenant_id,legal_entity_id,name) VALUES($1,$2,'Scope branch') RETURNING id`,[w.a.tenantId,w.a.legalEntityId])).rows[0].id;
  const scoped=await w.member(w.a.tenantId,'work-scoped',['freight_ops']);const sid=(await scoped.get('/me')).body.membershipId;await w.su.query(`UPDATE platform.membership_roles SET legal_entity_id=$2,branch_id=$3 WHERE membership_id=$1`,[sid,w.a.legalEntityId,branch]);
  const root=(await staff.cmd('/work/items',base())).body;const own=(await staff.cmd('/work/items',{...base(),branchId:branch,assigneeMembershipId:sid})).body;
  expect((await scoped.get('/work/items')).body.some((i:any)=>i.id===root.id)).toBe(false);expect((await scoped.get('/work/items')).body.some((i:any)=>i.id===own.id)).toBe(true);expect((await scoped.get(`/work/items/${root.id}`)).status).toBe(403);expect((await cmd(scoped,root.id,'start')).status).toBe(403);expect((await scoped.cmd('/work/items',base())).status).toBe(403);
  const foreign=await w.member(w.b.tenantId,'work-foreign',['owner']);const fid=(await foreign.get('/me')).body.membershipId;expect((await staff.cmd('/work/items',{...base(),assigneeMembershipId:fid})).status).toBe(422);expect((await foreign.get(`/work/items/${own.id}`)).status).toBe(404);
  const party=await makeParty(w.owner,'Work portal',['customer']);const portal=await w.member(w.a.tenantId,'work-portal',['owner'],{workspace:'customer',partyId:party});expect((await portal.get('/work/items')).status).toBe(403);expect((await w.owner.cmd('/work/items',{...base(),assigneeMembershipId:(await portal.get('/me')).body.membershipId})).status).toBe(422);
  const c=await w.appPool.connect();try{await c.query('BEGIN');await c.query(`SELECT set_config('app.tenant_id',$1,true)`,[w.b.tenantId]);expect((await c.query(`SELECT * FROM collab.work_items WHERE id=$1`,[own.id])).rows).toEqual([]);}finally{await c.query('ROLLBACK');c.release();}
 });
});
