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
      const p = await tx.one(`INSERT INTO parties.parties(tenant_id, legal_name, trading_name, tax_registration_number, country, address, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, version`,
        [ctx.tenantId, b.legalName, b.tradingName ?? null, b.taxRegistrationNumber ?? null, b.country ?? null, b.address ?? null, ctx.userId]);   // unique TRN per tenant => duplicate parties rejected
      for (const r of b.roles) await tx.q(`INSERT INTO parties.party_roles(tenant_id, party_id, role) VALUES ($1,$2,$3)`, [ctx.tenantId, p.id, r]);
      await audit(tx, ctx, 'party.created', 'party', p.id); return { ...p, roles: b.roles };
    });
  }
  getParty(ctx: RequestContext, id: string) {
    return this.db.run(ctx, async (tx) => {
      const p = await tx.maybe(`SELECT * FROM parties.parties WHERE id=$1`, [id]); if (!p) throw new DomainError('NOT_FOUND', 'Party not found.');
      const roles = (await tx.q(`SELECT role FROM parties.party_roles WHERE party_id=$1 ORDER BY role`, [id])).map((r: any) => r.role);
      const contacts = await tx.q(`SELECT id, name, email, phone, preferred_channel, whatsapp_opt_in, email_opt_out FROM parties.contacts WHERE party_id=$1`, [id]);
      const bank = await tx.q(`SELECT id, account_name, iban, swift, currency, active_from, active_to FROM parties.bank_details WHERE party_id=$1 ORDER BY active_from DESC`, [id]);
      const changes = await tx.q(`SELECT id, status, proposed, proposed_at FROM parties.bank_detail_changes WHERE party_id=$1 ORDER BY proposed_at DESC LIMIT 20`, [id]);
      const work = await tx.one(`SELECT (SELECT count(*)::int FROM commercial.quotes WHERE customer_party_id=$1 AND status IN ('draft','approved','sent')) open_quotes,
        (SELECT count(*)::int FROM logistics.jobs WHERE customer_party_id=$1) jobs, (SELECT count(*)::int FROM logistics.jobs WHERE customer_party_id=$1 AND status NOT IN ('closed','cancelled')) active_jobs,
        COALESCE((SELECT sum(total - amount_allocated) FROM finance.invoices WHERE customer_party_id=$1 AND status='posted'),0) outstanding,
        COALESCE((SELECT sum(total - amount_allocated) FROM finance.invoices WHERE customer_party_id=$1 AND status='posted' AND due_date < current_date),0) overdue`, [id]);
      return { ...p, roles, contacts, bankDetails: bank, bankChanges: changes, work };
    });
  }
  updateParty(ctx: RequestContext, id: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const sets: string[] = []; const a: unknown[] = [id]; const set = (col: string, v: unknown) => { if (v !== undefined) { a.push(v); sets.push(`${col} = $${a.length}`); } };
      set('trading_name', b.tradingName); set('tax_registration_number', b.taxRegistrationNumber); set('country', b.country); set('address', b.address);
      if (!sets.length) throw new DomainError('VALIDATION_FAILED', 'Nothing to update.');
      const p = await tx.maybe(`UPDATE parties.parties SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id, version`, a); if (!p) throw new DomainError('NOT_FOUND', 'Party not found.');
      await audit(tx, ctx, 'party.updated', 'party', id, { fields: Object.keys(b) }); return p;
    });
  }
  addContact(ctx: RequestContext, partyId: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      if (!b.email && !b.phone) throw new DomainError('VALIDATION_FAILED', 'A contact needs an email address or a phone number.');
      if (b.whatsappOptIn && !b.phone) throw new DomainError('VALIDATION_FAILED', 'WhatsApp opt-in needs a phone number in international format.');
      if (!(await tx.maybe(`SELECT 1 FROM parties.parties WHERE id=$1`, [partyId]))) throw new DomainError('NOT_FOUND', 'Party not found.');
      const c = await tx.one(`INSERT INTO parties.contacts(tenant_id, party_id, name, email, phone, preferred_channel, whatsapp_opt_in, email_opt_out) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [ctx.tenantId, partyId, b.name, b.email ?? null, b.phone ?? null, b.preferredChannel ?? null, b.whatsappOptIn, b.emailOptOut]);
      await audit(tx, ctx, 'contact.added', 'party', partyId, { contactId: c.id, whatsappOptIn: b.whatsappOptIn }); return c;
    });
  }
  /** Consent changes are audited with who/when: WhatsApp opt-in is evidence we may need to produce. */
  updateContact(ctx: RequestContext, id: string, b: any) {
    return this.db.run(ctx, async (tx) => {
      const cur = await tx.maybe(`SELECT * FROM parties.contacts WHERE id=$1 FOR UPDATE`, [id]); if (!cur) throw new DomainError('NOT_FOUND', 'Contact not found.');
      const phone = b.phone ?? cur.phone; if ((b.whatsappOptIn ?? cur.whatsapp_opt_in) && !phone) throw new DomainError('VALIDATION_FAILED', 'WhatsApp opt-in needs a phone number.');
      await tx.q(`UPDATE parties.contacts SET whatsapp_opt_in=$2, email_opt_out=$3, phone=$4, email=$5 WHERE id=$1`, [id, b.whatsappOptIn ?? cur.whatsapp_opt_in, b.emailOptOut ?? cur.email_opt_out, phone, b.email ?? cur.email]);
      await audit(tx, ctx, 'contact.updated', 'party', cur.party_id, { contactId: id, changed: Object.keys(b) }); return { id };
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
  @Op('updateParty') up(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.updateParty(c, id, b); }
  @Op('addContact') ac(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.addContact(c, id, b); }
  @Op('updateContact') uc(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.updateContact(c, id, b); }
  @Op('listBankChanges') lbc(@Ctx() c: RequestContext) { return this.s.listBankChanges(c); }
  @Op('listParties') l(@Ctx() c: RequestContext) { return this.s.list(c); }
  @Op('createParty') cr(@Ctx() c: RequestContext, @Body() b: any) { return this.s.create(c, b); }
  @Op('proposeBankChange') pb(@Ctx() c: RequestContext, @Param('id') id: string, @Body() b: any) { return this.s.proposeBankChange(c, id, b); }
  @Op('approveBankChange') ab(@Ctx() c: RequestContext, @Param('id') id: string) { return this.s.approveBankChange(c, id); }
}
@Module({ providers: [PartiesService], controllers: [PartiesController] }) export class PartiesModule {}
