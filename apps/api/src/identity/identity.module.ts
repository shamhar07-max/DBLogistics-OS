import { Body, Controller, Inject, Injectable, Module } from '@nestjs/common';
import { Ctx, Db, Op, type RequestContext } from '../platform';

@Injectable()
export class IdentityService {
  constructor(@Inject(Db) private db: Db) {}
  async me(ctx: RequestContext) {
    const party = ctx.partyId ? await this.db.run(ctx, (tx) => tx.maybe<{ legal_name: string }>(`SELECT legal_name FROM parties.parties WHERE id=$1`, [ctx.partyId])) : null;
    return { userId: ctx.userId, tenantId: ctx.tenantId, workspace: ctx.workspace, partyId: ctx.partyId, partyName: party?.legal_name ?? null, email: ctx.email, permissions: [...ctx.permissions.keys()].sort() };
  }
  memberships(ctx: RequestContext) { return this.db.asUser(ctx.userId, (tx) => tx.q(`SELECT * FROM platform.my_memberships()`)); }
}
@Controller()
export class IdentityController {
  constructor(@Inject(IdentityService) private s: IdentityService) {}
  @Op('getMe') me(@Ctx() c: RequestContext) { return this.s.me(c); }
  @Op('listMemberships') ms(@Ctx() c: RequestContext) { return this.s.memberships(c); }
}
@Module({ providers: [IdentityService], controllers: [IdentityController] })
export class IdentityModule {}
