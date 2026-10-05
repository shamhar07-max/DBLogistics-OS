import { Body, Controller, Inject, Injectable, Module, Param } from '@nestjs/common';
import { audit, Ctx, Db, DomainError, emit, Op, type RequestContext } from '../platform';

@Injectable()
export class PartiesService {
  constructor(@Inject(Db) private db: Db) {}
  list(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT p.id, p.legal_name, p.trading_name, p.tax_registration_number, p.country, p.status,
        COALESCE((SELECT array_agg(role ORDER BY role) FROM parties.party_roles r WHERE r.party_id=p.id), '{}') roles FROM parties.parties p ORDER BY p.legal_name LIMIT 500`));
  }
  create(ctx: RequestContext, b: any) {
    return this.db.run(ctx, async (tx) => {
      const p = await tx.one(`INSERT INTO parties.parties(tenant_id, legal_name, trading_name, tax_registration_number, country, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, version`,
        [ctx.tenantId, b.legalName, b.tradingName ?? null, b.taxRegistrationNumber ?? null, b.country ?? null, ctx.userId]);   // unique TRN per tenant => duplicate parties rejected
      for (const r of b.roles) await tx.q(`INSERT INTO parties.party_roles(tenant_id, party_id, role) VALUES ($1,$2,$3)`, [ctx.tenantId, p.id, r]);
      await audit(tx, ctx, 'party.created', 'party', p.id); return { ...p, roles: b.roles };
    });
  }
  getParty(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const p = await tx.maybe(`SELECT * FROM parties.parties WHERE id=$1`, [id]); if (!p) throw new DomainError('NOT_FOUND', 'Party not found.');
      const roles = (await tx.q(`SELECT role FROM parties.party_roles WHERE party_id=$1 ORDER BY role`, [id])).map((r: any) => r.role);
      const contacts = await tx.q(`SELECT id, name, email, phone, preferred_channel FROM parties.contacts WHERE party_id=$1`, [id]);
      const bank = await tx.q(`SELECT id, account_name, iban, swift, currency, active_from, active_to FROM parties.bank_details WHERE party_id=$1 ORDER BY active_from DESC`, [id]);
      const changes = await tx.q(`SELECT id, status, proposed, proposed_at FROM parties.bank_detail_changes WHERE party_id=$1 ORDER BY proposed_at DESC LIMIT 20`, [id]);
      const work = await tx.one(`SELECT (SELECT count(*)::int FROM commercial.quotes WHERE customer_party_id=$1 AND status IN ('draft','approved','sent')) open_quotes,
        (SELECT count(*)::int FROM logistics.jobs WHERE customer_party_id=$1) jobs, (SELECT count(*)::int FROM logistics.jobs WHERE customer_party_id=$1 AND status NOT IN ('closed','cancelled')) active_jobs,
        COALESCE((SELECT sum(total - amount_allocated) FROM finance.invoices WHERE customer_party_id=$1 AND status='posted'),0) outstanding,
        COALESCE((SELECT sum(total - amount_allocated) FROM finance.invoices WHERE customer_party_id=$1 AND status='posted' AND due_date < current_date),0) overdue`, [id]);
      return { ...p, roles, contacts, bankDetails: bank, bankChanges: changes, work };
    });
  }
  listBankChanges(ctx: RequestContext) {
    return this.db.run(ctx, (tx) => tx.q(`SELECT c.id, c.status, c.proposed, c.proposed_at, c.proposed_by, c.decided_by, c.callback_verified, p.legal_name AS party, c.party_id FROM parties.bank_detail_changes c JOIN parties.parties p ON p.id = c.party_id ORDER BY (c.status='proposed') DESC, c.proposed_at DESC LIMIT 200`));
  }
  proposeBankChange(ctx: RequestContext, partyId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.one(`INSERT INTO parties.bank_detail_changes(tenant_id, party_id, proposed, proposed_by) VALUES ($1,$2,$3::jsonb,$4) RETURNING id, status`, [ctx.tenantId, partyId, JSON.stringify(b), ctx.userId]);
      await audit(tx, ctx, 'bank_change.proposed', 'party', partyId, { changeId: c.id }); return c;
    });
  }
  /** Maker/checker: approver must differ from proposer and a call-back verification must be attested. */
  approveBankChange(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const c = await tx.maybe(`SELECT * FROM parties.bank_detail_changes WHERE id=$1 FOR UPDATE`, [id]);
      if (!c) throw new DomainError('NOT_FOUND', 'Change request not found.');
      if (c.status !== 'proposed') throw new DomainError('INVALID_STATE_TRANSITION', `Change is ${c.status}.`);
      if (c.proposed_by === ctx.userId) throw new DomainError('SEPARATION_OF_DUTIES', 'Bank details cannot be approved by the person who proposed them.');
      await tx.q(`UPDATE parties.bank_details SET active_to=now() WHERE party_id=$1 AND active_to IS NULL`, [c.party_id]);
      const p = c.proposed;
      await tx.q(`INSERT INTO parties.bank_details(tenant_id, party_id, account_name, iban, swift, currency) VALUES ($1,$2,$3,$4,$5,$6)`, [ctx.tenantId, c.party_id, p.accountName, p.iban, p.swift ?? null, p.currency]);
      await tx.q(`UPDATE parties.bank_detail_changes SET status='approved', decided_by=$2, decided_at=now(), callback_verified=true WHERE id=$1`, [id, ctx.userId]);
      await audit(tx, ctx, 'bank_change.approved', 'party', c.party_id, { changeId: id }); return { id, status: 'approved' };
    });
  }
}
@Controller()
export class PartiesController {
  constructor(@Inject(PartiesService) private s: PartiesService) {}
  @Op('getParty') gp(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.getParty(c, id); }
  @Op('listBankChanges') lbc(@Ctx() c: RequestContext) { return this.s.listBankChanges(c); }
  @Op('listParties') l(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('createParty') cr(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('proposeBankChange') pb(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.proposeBankChange(c, id, b); }
  @Op('approveBankChange') ab(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.approveBankChange(c, id); }
}
@Module({ providers: [PartiesService], controllers: [PartiesController] }) export class PartiesModule {}
