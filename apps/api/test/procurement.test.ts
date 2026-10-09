import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { world, close, makeParty, type World, type Client } from './helpers';
import { addMemberToTenant } from '../src/provisioning';

let w: World, recorder: Client, checker: Client, supplier: string, other: string;
const date = (days: number) => new Date(Date.now()+days*86400000).toISOString().slice(0,10);
const body = () => ({ legalEntityId: w.a.legalEntityId, mode: 'ocean_fcl', origin: 'Shanghai', destination: 'Jebel Ali', requirements: '22 pallets, include destination handling and exclusions', currency: 'AED', responseDeadline: new Date(Date.now()+86400000).toISOString(), supplierPartyIds: [supplier,other] });
const offer = (supplierPartyId = supplier, freight = '1000.0001') => ({ supplierPartyId, freight, localCharges: '100.0002', transitDays: 20, freeDays: 14, validUntil: date(10), terms: 'Includes terminal handling; excludes customs duty.' });
async function issued() { const r = await w.owner.cmd('/rfqs',body()); expect(r.status).toBe(201); const i = await w.owner.cmd(`/rfqs/${r.body.id}/issue`,{},randomUUID(),{'If-Match':'1'}); expect(i.status).toBe(200); return i.body; }
beforeAll(async () => { w=await world(); recorder=await w.member(w.a.tenantId,'rate-recorder',['pricing']); checker=await w.member(w.a.tenantId,'rate-checker',['pricing']); supplier=await makeParty(w.owner,'Ocean Rate One',['supplier','carrier']); other=await makeParty(w.owner,'Ocean Rate Two',['carrier']); });
afterAll(async () => close(w));

describe('carrier rate procurement', () => {
  it('validates invitations, date boundaries and permissions before creating anything', async () => {
    const customer = await makeParty(w.owner,'Only a customer',['customer']);
    expect((await w.owner.cmd('/rfqs',{...body(),supplierPartyIds:[customer]})).status).toBe(422);
    expect((await w.owner.cmd('/rfqs',{...body(),supplierPartyIds:[supplier,supplier]})).status).toBe(422);
    expect((await w.owner.cmd('/rfqs',{...body(),responseDeadline:new Date(Date.now()-1000).toISOString()})).status).toBe(422);
    const sales=await w.member(w.a.tenantId,'rate-sales',['sales']);
    expect((await sales.cmd('/rfqs',body())).status).toBe(403);
    expect((await w.owner.cmd('/rfqs',body(),randomUUID(),{})).status).toBe(201);
    expect((await w.owner.get('/rfqs/not-a-uuid')).status).toBe(422);
  });
  it('freezes issued requirements and records immutable supplier revisions with exact decimal comparisons', async () => {
    const r=await issued();
    const a=await recorder.cmd(`/rfqs/${r.id}/offers`,offer(supplier,'1000.0001')); expect(a.status).toBe(201); expect(a.body.total).toBe('1100.0003');
    const b=await recorder.cmd(`/rfqs/${r.id}/offers`,offer(other,'999.9999')); expect(b.status).toBe(201);
    const revised=await recorder.cmd(`/rfqs/${r.id}/offers`,offer(supplier,'900.0001')); expect(revised.body.revision).toBe(2);
    const compare=await checker.get(`/rfqs/${r.id}`); expect(compare.body.history).toHaveLength(3); expect(compare.body.comparison).toHaveLength(2);
    expect(compare.body.comparison[0].id).toBe(revised.body.id);
    await expect(w.su.query(`UPDATE commercial.rfq_offers SET terms='tampered terms' WHERE id=$1`,[a.body.id])).rejects.toThrow(/append-only/);
    await expect(w.su.query(`UPDATE commercial.rfqs SET origin='Dubai' WHERE id=$1`,[r.id])).rejects.toThrow(/immutable/);
    expect((await checker.cmd(`/rfqs/${r.id}/award`,{offerId:a.body.id,reason:'Select the superseded response'})).body.code).toBe('INVALID_STATE_TRANSITION');
  });
  it('enforces independent award and publishes exactly one rate, audit and outbox event on replay', async () => {
    const r=await issued(); const a=await recorder.cmd(`/rfqs/${r.id}/offers`,offer());
    const award={offerId:a.body.id,reason:'Best total landed rate and suitable transit time'};
    expect((await w.owner.cmd(`/rfqs/${r.id}/award`,award)).body.code).toBe('SEPARATION_OF_DUTIES');
    expect((await recorder.cmd(`/rfqs/${r.id}/award`,award)).body.code).toBe('SEPARATION_OF_DUTIES');
    expect((await checker.cmd(`/rfqs/${r.id}/award`,award,randomUUID(),{'If-Match':'1'})).body.code).toBe('VERSION_CONFLICT');
    const key=randomUUID(); const [x,y]=await Promise.all([checker.cmd(`/rfqs/${r.id}/award`,award,key,{'If-Match':'2'}),checker.cmd(`/rfqs/${r.id}/award`,award,key,{'If-Match':'2'})]);
    expect(x.status).toBe(200); expect(y.body).toEqual(x.body); expect(x.body.status).toBe('awarded');
    const rate=(await w.su.query(`SELECT * FROM commercial.rate_versions WHERE id=$1`,[x.body.awarded_rate_id])).rows[0];
    expect(rate.amount).toBe('1100.0003'); expect(rate.conditions.offerId).toBe(a.body.id); expect(rate.status).toBe('approved');
    expect((await w.su.query(`SELECT count(*)::int n FROM platform.outbox WHERE aggregate_id=$1 AND topic='RfqAwarded'`,[r.id])).rows[0].n).toBe(1);
    expect((await recorder.cmd(`/rfqs/${r.id}/offers`,offer())).body.code).toBe('INVALID_STATE_TRANSITION');
    expect((await checker.cmd(`/rfqs/${r.id}/award`,award)).body.code).toBe('INVALID_STATE_TRANSITION');
  });
  it('serializes concurrent revisions and rejects uninvited suppliers and expired responses', async () => {
    const r=await issued(); const [a,b]=await Promise.all([recorder.cmd(`/rfqs/${r.id}/offers`,offer()),recorder.cmd(`/rfqs/${r.id}/offers`,offer(supplier,'800.01'))]);
    expect([a.body.revision,b.body.revision].sort()).toEqual([1,2]);
    const uninvited=await makeParty(w.owner,'Uninvited supplier',['supplier']);
    expect((await recorder.cmd(`/rfqs/${r.id}/offers`,offer(uninvited))).status).toBe(422);
    expect((await recorder.cmd(`/rfqs/${r.id}/offers`,{...offer(),validUntil:date(-1)})).status).toBe(422);
    expect((await recorder.cmd(`/rfqs/${r.id}/offers`,{...offer(),validUntil:'2026-02-30'})).status).toBe(422);
    expect((await recorder.cmd(`/rfqs/${r.id}/offers`,{...offer(),freight:'-1'})).status).toBe(422);
  });
  it('isolates tenants and customer portals, including raw SQL under RLS', async () => {
    const r=await issued();
    // A real member of the other tenant still cannot resolve this record.
    const outsider=await w.member(w.b.tenantId,'foreign-pricing',['pricing']);
    expect((await outsider.get(`/rfqs/${r.id}`)).status).toBe(404);
    const foreignSupplier=await makeParty(w.as((await w.su.query(`SELECT subject FROM platform.users WHERE id=$1`,[w.b.ownerUserId])).rows[0].subject,w.b.tenantId),'Foreign supplier',['supplier']);
    expect((await w.owner.cmd('/rfqs',{...body(),supplierPartyIds:[foreignSupplier]})).status).toBe(422);
    const customer=await makeParty(w.owner,'Portal procurement isolation',['customer']);
    const portal=await w.member(w.a.tenantId,'portal-rates',['owner'],{workspace:'customer',partyId:customer});
    expect((await portal.get('/rfqs')).status).toBe(403);
    const c=await w.appPool.connect(); try { await c.query('BEGIN');await c.query(`SELECT set_config('app.tenant_id',$1,true)`,[w.b.tenantId]); expect((await c.query(`SELECT * FROM commercial.rfqs WHERE id=$1`,[r.id])).rows).toEqual([]); } finally { await c.query('ROLLBACK');c.release(); }
  });
  it('filters legal-entity scoped lists and rejects commands outside the grant', async () => {
    const second=(await w.su.query(`INSERT INTO org.legal_entities(tenant_id,name,base_currency) VALUES ($1,'Other legal entity','AED') RETURNING id`,[w.a.tenantId])).rows[0].id;
    const sub=`scoped-rates-${randomUUID()}`; await addMemberToTenant(w.appPool,w.a.tenantId,{subject:sub,roles:['pricing'],legalEntityId:second}); const scoped=w.as(sub);
    const r=await issued(); expect((await scoped.get(`/rfqs/${r.id}`)).status).toBe(403); expect((await scoped.cmd('/rfqs',body())).status).toBe(403);
    const own=await scoped.cmd('/rfqs',{...body(),legalEntityId:second}); expect(own.status).toBe(201);
    expect((await scoped.get('/rfqs')).body.map((x:any)=>x.id)).toEqual([own.body.id]);
  });
});
