import { Inject, Injectable } from '@nestjs/common';
import { audit, Db, DomainError, expectVersion, isExternal, type RequestContext, type Tx } from '../platform';
export function tenantAdministrator(ctx: RequestContext) {
  if (isExternal(ctx) || !ctx.permissions.get('admin.tenant')?.some(g=>g.legalEntityId===null && g.branchId===null))
    throw new DomainError('FORBIDDEN','Tenant-wide internal administration permission is required.');
}
@Injectable()
export class AccessService {
  constructor(@Inject(Db) private db: Db) {}
  private async member(tx: Tx,ctx: RequestContext,id: string) {
    const m=await tx.maybe(`SELECT * FROM platform.memberships WHERE id=$1 AND tenant_id=$2 FOR UPDATE`,[id,ctx.tenantId]);
    if (!m) throw new DomainError('NOT_FOUND','Membership not found.');
    expectVersion(m.version,ctx);return m;
  }
  private async preserveAdministrator(tx:Tx) {
    if (!await tx.maybe(`SELECT 1 FROM platform.memberships m JOIN platform.membership_roles mr ON mr.membership_id=m.id JOIN platform.role_permissions rp ON rp.tenant_id=mr.tenant_id AND rp.role_id=mr.role_id WHERE m.status='active' AND m.workspace IN ('staff','platform_admin') AND mr.legal_entity_id IS NULL AND mr.branch_id IS NULL AND rp.permission='admin.tenant' LIMIT 1`))
      throw new DomainError('INVALID_STATE_TRANSITION','The tenant must retain an active administrator with tenant-wide access.');
  }
  status(ctx: RequestContext,id: string,b: any) {
    tenantAdministrator(ctx);
    return this.db.run(ctx,async tx=>{
      // Serialize identity changes within a tenant; do not race two last-owner changes.
      await tx.q(`SELECT id FROM platform.tenants WHERE id=$1 FOR UPDATE`,[ctx.tenantId]);
      const m=await this.member(tx,ctx,id);
      if (m.user_id===ctx.userId) throw new DomainError('FORBIDDEN','Use another administrator to change your own membership.');
      if (m.status===b.status) throw new DomainError('INVALID_STATE_TRANSITION','Membership already has this status.');
      if (b.status==='active' && m.workspace!=='staff' && !m.party_id) throw new DomainError('VALIDATION_FAILED','External membership must be linked to a party.');
      const out=await tx.one(`UPDATE platform.memberships SET status=$2,token_valid_after=floor(extract(epoch from now()))::bigint WHERE id=$1 RETURNING id,status,version`,[id,b.status]);
      await this.preserveAdministrator(tx);
      await audit(tx,ctx,'membership.status-changed','membership',id,{from:m.status,to:b.status,reason:b.reason});return out;
    });
  }
  revoke(ctx: RequestContext,id: string,b: any) {
    tenantAdministrator(ctx);
    return this.db.run(ctx,async tx=>{await this.member(tx,ctx,id);
      const out=await tx.one(`UPDATE platform.memberships SET token_valid_after=floor(extract(epoch from now()))::bigint WHERE id=$1 RETURNING id,version,token_valid_after`,[id]);
      await audit(tx,ctx,'membership.sessions-revoked','membership',id,{reason:b.reason,cutoff:out.token_valid_after});return out;
    });
  }
  replace(ctx: RequestContext,id: string,b: any) {
    tenantAdministrator(ctx);
    return this.db.run(ctx,async tx=>{
      await tx.q(`SELECT id FROM platform.tenants WHERE id=$1 FOR UPDATE`,[ctx.tenantId]);const m=await this.member(tx,ctx,id);
      if(m.user_id===ctx.userId) throw new DomainError('FORBIDDEN','Use another administrator to change your own role grants.');
      const roles=await tx.q(`SELECT id,key FROM platform.roles WHERE key=ANY($1::text[])`,[b.grants.map((g:any)=>g.role)]);
      if(b.grants.some((g:any)=>!roles.some(r=>r.key===g.role))) throw new DomainError('VALIDATION_FAILED','Unknown role template.');
      const externalRoles:Record<string,string[]>={customer:['customer_portal'],agent:['agent_portal'],transporter:['transporter_portal'],driver:['driver'],warehouse:['warehouse_operator']};
      if(isExternal({...ctx,workspace:m.workspace}) && b.grants.some((g:any)=>!externalRoles[m.workspace]?.includes(g.role))) throw new DomainError('FORBIDDEN','External memberships require matching portal role templates.');
      for(const g of b.grants) {
        if(g.legalEntityId && !await tx.maybe(`SELECT 1 FROM org.legal_entities WHERE id=$1`,[g.legalEntityId])) throw new DomainError('VALIDATION_FAILED','Legal entity not found.');
        if(g.branchId && !await tx.maybe(`SELECT 1 FROM org.branches WHERE id=$1 AND legal_entity_id=$2`,[g.branchId,g.legalEntityId])) throw new DomainError('VALIDATION_FAILED','Branch must belong to the selected legal entity.');
      }
      await tx.q(`DELETE FROM platform.membership_roles WHERE membership_id=$1`,[id]);
      for(const g of b.grants) await tx.q(`INSERT INTO platform.membership_roles(tenant_id,membership_id,role_id,legal_entity_id,branch_id) VALUES($1,$2,$3,$4,$5)`,[ctx.tenantId,id,roles.find(r=>r.key===g.role)!.id,g.legalEntityId,g.branchId]);
      const out=await tx.one(`UPDATE platform.memberships SET token_valid_after=floor(extract(epoch from now()))::bigint WHERE id=$1 RETURNING id,version`,[id]);
      await this.preserveAdministrator(tx);
      await audit(tx,ctx,'membership.grants-replaced','membership',id,{reason:b.reason,grants:b.grants});return out;
    });
  }
  operations(ctx: RequestContext) {
    tenantAdministrator(ctx);
    return this.db.run(ctx,tx=>tx.one(`SELECT
      (SELECT count(*)::int FROM platform.outbox WHERE published_at IS NULL) AS pending_events,
      (SELECT COALESCE(extract(epoch from now()-min(occurred_at)),0)::int FROM platform.outbox WHERE published_at IS NULL) AS oldest_event_seconds,
      (SELECT count(*)::int FROM automation.workflow_runs WHERE status='failed') AS failed_workflows,
      (SELECT count(*)::int FROM integ.outbound_messages WHERE status='failed') AS failed_messages,
      (SELECT count(*)::int FROM platform.document_versions WHERE scan_status='pending') AS pending_scans,
      (SELECT count(*)::int FROM platform.memberships WHERE status='active') AS active_members,
      now() AS observed_at`));
  }
}
