import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import request from 'supertest';
import {SignJWT} from 'jose';
import {randomUUID} from 'node:crypto';
import {world,close,makeParty,token,SECRET,type World} from './helpers';
import {Db} from '../src/platform';
let w:World;
beforeAll(async()=>{w=await world();});afterAll(async()=>close(w));
const bearer=(sub:string,iat:number)=>new SignJWT({}).setProtectedHeader({alg:'HS256'}).setSubject(sub).setAudience('dbl-api').setIssuedAt(iat).setExpirationTime('1h').sign(new TextEncoder().encode(SECRET));
const direct=(t:string)=>request(w.app.getHttpServer()).get('/api/v1/me').set('Authorization',`Bearer ${t}`).set('X-Tenant-Id',w.a.tenantId);
it('provides liveness and readiness without secrets and returns 503 when the database probe fails',async()=>{
 expect((await request(w.app.getHttpServer()).get('/api/v1/health')).body).toEqual({status:'ok',service:'api'});expect((await request(w.app.getHttpServer()).get('/api/v1/health/ready')).status).toBe(200);
 const spy=vi.spyOn(w.app.get(Db).pool,'query').mockRejectedValueOnce(new Error('secret-database-password'));
 try {const r=await request(w.app.getHttpServer()).get('/api/v1/health/ready');expect(r.status).toBe(503);expect(JSON.stringify(r.body)).not.toContain('secret-database-password');}finally{spy.mockRestore();}
 expect((await w.owner.get('/admin/operations')).status).toBe(200);
});
it('revokes older tokens, preserves tenant isolation, and accepts only tokens issued after the cutoff',async()=>{
 const target=await w.member(w.a.tenantId,'revocation-target',['sales']);const m=(await target.get('/me')).body.membershipId;const old=await bearer(target.sub,Math.floor(Date.now()/1000)-60);expect((await direct(old)).status).toBe(200);
 const key=randomUUID();const b={reason:'Device lost; revoke all previously issued access tokens'};const r=await w.owner.cmd(`/admin/members/${m}/revoke-sessions`,b,key,{'If-Match':'1'});expect(r.status).toBe(200);expect((await w.owner.cmd(`/admin/members/${m}/revoke-sessions`,b,key)).body).toEqual(r.body);expect((await direct(old)).status).toBe(401);expect((await direct(await token(target.sub))).status).toBe(401);expect((await direct(await bearer(target.sub,Number(r.body.token_valid_after)+1))).status).toBe(200);
 const other=await w.member(w.b.tenantId,'foreign-owner',['owner']);expect((await other.cmd(`/admin/members/${m}/revoke-sessions`,b)).status).toBe(404);
});
it('suspends and reactivates with fresh-login requirements, version checks and immutable audit evidence',async()=>{
 const t=await w.member(w.a.tenantId,'suspend-target',['freight_ops']);const m=(await t.get('/me')).body.membershipId;expect((await w.owner.cmd(`/admin/members/${m}/status`,{status:'suspended',reason:'Pending access review for department transfer'},randomUUID(),{'If-Match':'99'})).body.code).toBe('VERSION_CONFLICT');
 const suspended=await w.owner.cmd(`/admin/members/${m}/status`,{status:'suspended',reason:'Pending access review for department transfer'},randomUUID(),{'If-Match':'1'});expect(suspended.status).toBe(200);expect((await t.get('/me')).status).toBe(403);
 const active=await w.owner.cmd(`/admin/members/${m}/status`,{status:'active',reason:'Department access review completed and approved'},randomUUID(),{'If-Match':String(suspended.body.version)});expect(active.status).toBe(200);expect((await t.get('/me')).status).toBe(401);const after=(await w.su.query(`SELECT token_valid_after FROM platform.memberships WHERE id=$1`,[m])).rows[0].token_valid_after;expect((await direct(await bearer(t.sub,Number(after)+1))).status).toBe(200);
 expect((await w.su.query(`SELECT count(*)::int n FROM platform.audit_events WHERE entity_id=$1 AND action='membership.status-changed'`,[m])).rows[0].n).toBe(2);const self=(await w.owner.get('/me')).body.membershipId;expect((await w.owner.cmd(`/admin/members/${self}/status`,{status:'revoked',reason:'Attempt to revoke my own last administrator access'})).status).toBe(403);
});
it('validates role/entity/branch grants and refuses scoped or external tenant administrators',async()=>{
 const target=await w.member(w.a.tenantId,'grant-target',['sales']);const m=(await target.get('/me')).body.membershipId;const branch=(await w.su.query(`INSERT INTO org.branches(tenant_id,legal_entity_id,name) VALUES($1,$2,'Grant test branch') RETURNING id`,[w.a.tenantId,w.a.legalEntityId])).rows[0].id;
 const b={reason:'Transfer into pricing with a reviewed branch scope',grants:[{role:'pricing',legalEntityId:w.a.legalEntityId,branchId:branch}]};expect((await w.owner.cmd(`/admin/members/${m}/grants`,{...b,grants:[{role:'pricing',branchId:branch}]})).status).toBe(422);expect((await w.owner.cmd(`/admin/members/${m}/grants`,{...b,grants:[{role:'pricing',legalEntityId:w.b.legalEntityId,branchId:null}]})).status).toBe(422);
 expect((await w.owner.cmd(`/admin/members/${m}/grants`,b,randomUUID(),{'If-Match':'1'})).status).toBe(200);const stored=(await w.su.query(`SELECT role_id,legal_entity_id,branch_id FROM platform.membership_roles WHERE membership_id=$1`,[m])).rows;expect(stored).toHaveLength(1);expect(stored[0].branch_id).toBe(branch);
 const scoped=await w.member(w.a.tenantId,'scoped-admin',['owner']);const sid=(await scoped.get('/me')).body.membershipId;await w.su.query(`UPDATE platform.membership_roles SET legal_entity_id=$2 WHERE membership_id=$1`,[sid,w.a.legalEntityId]);expect((await scoped.get('/admin/members')).status).toBe(403);expect((await scoped.get('/admin/operations')).status).toBe(403);
 const party=await makeParty(w.owner,'External access isolation',['customer']);const portal=await w.member(w.a.tenantId,'external-admin',['owner'],{workspace:'customer',partyId:party});expect((await portal.get('/admin/members')).status).toBe(403);
 expect((await w.owner.cmd('/admin/members',{subject:'malicious-external',role:'owner',workspace:'customer',partyId:party})).status).toBe(403);
});
