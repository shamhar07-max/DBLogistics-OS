import { Body, Controller, Inject, Injectable, Module, Param, ParseUUIDPipe } from '@nestjs/common';
import { AccessService, tenantAdministrator } from './access.service';
import { audit, Ctx, Db, DomainError, Op, Qry, type RequestContext } from '../platform';

@Injectable()
export class AdministrationService {
  constructor(@Inject(Db) private db: Db) {}
  members(ctx: RequestContext) {
    tenantAdministrator(ctx);
    return this.db.run(ctx, (tx) => tx.q(`SELECT m.id, m.workspace, m.status, m.party_id, m.version, u.subject, u.email, u.display_name,
      COALESCE((SELECT json_agg(json_build_object('role', r.key, 'name', r.name, 'legalEntityId', mr.legal_entity_id)) FROM platform.membership_roles mr JOIN platform.roles r ON r.id = mr.role_id WHERE mr.membership_id = m.id), '[]') AS roles
      FROM platform.memberships m JOIN platform.users u ON u.id = m.user_id ORDER BY u.subject LIMIT 500`));
  }
  /** Adds (or links) a user and grants a ROLE TEMPLATE. External workspaces must be tied to a party so data scoping applies. */
  addMember(ctx: RequestContext, b: any) {
    tenantAdministrator(ctx);
    return this.db.run(ctx, async (tx) => {
      const role = await tx.maybe(`SELECT id FROM platform.roles WHERE key=$1`, [b.role]); if (!role) throw new DomainError('VALIDATION_FAILED', `Unknown role "${b.role}".`);
      if (b.workspace !== 'staff' && !b.partyId) throw new DomainError('VALIDATION_FAILED', 'External members must be linked to a party.');
      const externalRoles: Record<string,string> = { customer:'customer_portal',agent:'agent_portal',transporter:'transporter_portal',driver:'driver',warehouse:'warehouse_operator' };
      if (b.workspace !== 'staff' && externalRoles[b.workspace] !== b.role) throw new DomainError('FORBIDDEN','Use the matching portal role template for external members.');
      const u = await tx.one(`INSERT INTO platform.users(subject, email) VALUES ($1,$2) ON CONFLICT (subject) DO UPDATE SET email = COALESCE(EXCLUDED.email, platform.users.email) RETURNING id`, [b.subject, b.email ?? null]);
      const m = await tx.one(`INSERT INTO platform.memberships(tenant_id, user_id, workspace, party_id) VALUES ($1,$2,$3,$4) RETURNING id`, [ctx.tenantId, u.id, b.workspace, b.partyId ?? null]);   // UNIQUE(tenant,user): one membership per tenant
      await tx.q(`INSERT INTO platform.membership_roles(tenant_id, membership_id, role_id, legal_entity_id) VALUES ($1,$2,$3,$4)`, [ctx.tenantId, m.id, role.id, b.legalEntityId ?? null]);
      await audit(tx, ctx, 'member.added', 'membership', m.id, { subject: b.subject, role: b.role, workspace: b.workspace }); return { id: m.id, subject: b.subject, role: b.role };
    });
  }
  roles(ctx: RequestContext) {
    tenantAdministrator(ctx);
    return this.db.run(ctx, (tx) => tx.q(`SELECT r.id, r.key, r.name, COALESCE((SELECT array_agg(permission ORDER BY permission) FROM platform.role_permissions rp WHERE rp.role_id = r.id), '{}') AS permissions,
      (SELECT count(*)::int FROM platform.membership_roles mr WHERE mr.role_id = r.id) AS members FROM platform.roles r ORDER BY r.name`));
  }
  audit(ctx: RequestContext, q: { entityType?: string; entityId?: string; limit: number }) {
    const w: string[] = []; const a: unknown[] = [];
    if (q.entityType) { a.push(q.entityType); w.push(`e.entity_type = $${a.length}`); } if (q.entityId) { a.push(q.entityId); w.push(`e.entity_id = $${a.length}`); }
    a.push(q.limit);
    return this.db.run(ctx, (tx) => tx.q(`SELECT e.id, e.at, e.action, e.entity_type, e.entity_id, e.actor_kind, e.request_id, e.detail, u.subject AS actor FROM platform.audit_events e LEFT JOIN platform.users u ON u.id = e.actor_user_id
      ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY e.id DESC LIMIT $${a.length}`, a));
  }
}
@Controller()
export class AdministrationController {
  constructor(@Inject(AdministrationService) private s: AdministrationService, @Inject(AccessService) private access: AccessService) {}
  @Op('changeMemberStatus') status(@Ctx() c: RequestContext,@Param('id',new ParseUUIDPipe()) id: string,@Body() b: any) {return this.access.status(c,id,b);}
  @Op('revokeMemberSessions') revoke(@Ctx() c: RequestContext,@Param('id',new ParseUUIDPipe()) id: string,@Body() b: any) {return this.access.revoke(c,id,b);}
  @Op('replaceMemberGrants') grants(@Ctx() c: RequestContext,@Param('id',new ParseUUIDPipe()) id: string,@Body() b: any) {return this.access.replace(c,id,b);}
  @Op('getOperationsHealth') health(@Ctx() c: RequestContext) {return this.access.operations(c);}
  @Op('listMembers') lm(@Ctx() c: RequestContext) { return this.s.members(c); }
  @Op('addMember') am(@Ctx() c: RequestContext, @Body() b: any) { return this.s.addMember(c, b); }
  @Op('listRoles') lr(@Ctx() c: RequestContext) { return this.s.roles(c); }
  @Op('listAuditEvents') la(@Ctx() c: RequestContext, @Qry() q: any) { return this.s.audit(c, q); }
}
@Module({ providers: [AdministrationService,AccessService], controllers: [AdministrationController] }) export class AdministrationModule {}
