import { DomainError, type RequestContext, type Tx } from '../../platform';
import type { PostingLine, SystemKey } from '../domain/posting';
import { isBalanced } from '../domain/posting';

export const SYSTEM_ACCOUNTS: Array<[SystemKey, string, string, 'asset' | 'liability' | 'revenue' | 'expense']> = [
  ['BANK', '1000', 'Bank', 'asset'], ['AR', '1100', 'Accounts receivable', 'asset'], ['VAT_IN', '1150', 'VAT input', 'asset'],
  ['AP', '2100', 'Accounts payable', 'liability'], ['ACCRUED_COST', '2150', 'Accrued costs', 'liability'], ['VAT_OUT', '2200', 'VAT output', 'liability'],
  ['ADVANCES', '2300', 'Customer advances', 'liability'], ['REVENUE', '4000', 'Freight & logistics revenue', 'revenue'], ['COST', '5000', 'Freight & logistics cost', 'expense'],
];
/** Seed the chart of accounts + a current-year open period for a legal entity (idempotent). */
export async function seedLedger(tx: Tx, tenantId: string, legalEntityId: string, year = new Date().getUTCFullYear()) {
  for (const [key, code, name, type] of SYSTEM_ACCOUNTS)
    await tx.q(`INSERT INTO finance.accounts(tenant_id, legal_entity_id, code, name, type, system_key) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`, [tenantId, legalEntityId, code, name, type, key]);
  for (let m = 0; m < 12; m++) {
    const s = new Date(Date.UTC(year, m, 1)), e = new Date(Date.UTC(year, m + 1, 0));
    await tx.q(`INSERT INTO finance.accounting_periods(tenant_id, legal_entity_id, start_date, end_date) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [tenantId, legalEntityId, s.toISOString().slice(0, 10), e.toISOString().slice(0, 10)]);
  }
}
export async function assertOpenPeriod(tx: Tx, legalEntityId: string, date: string) {
  const p = await tx.maybe(`SELECT status FROM finance.accounting_periods WHERE legal_entity_id=$1 AND $2::date BETWEEN start_date AND end_date`, [legalEntityId, date]);
  if (!p) throw new DomainError('PERIOD_NOT_FOUND', 'No accounting period covers the posting date.', { postingDate: date });
  if (p.status !== 'open') throw new DomainError('ACCOUNTING_PERIOD_CLOSED', 'Select a posting date in an open period.', { postingDate: date });
}
export interface PostJournal { legalEntityId: string; postingDate: string; currency: string; sourceType: string; sourceId: string; description: string; lines: Array<PostingLine & { partyId?: string | null; jobId?: string | null }>; reversesJournalId?: string }
/** Writes a journal + lines. Balance is validated here AND by a deferred constraint trigger at COMMIT. */
export async function postJournal(tx: Tx, ctx: RequestContext, j: PostJournal): Promise<string> {
  if (!isBalanced(j.lines)) throw new DomainError('VALIDATION_FAILED', 'Journal is not balanced.');
  await assertOpenPeriod(tx, j.legalEntityId, j.postingDate);
  const ref = (await tx.one<{ r: string }>(`SELECT platform.next_ref('journal', 'JNL') r`)).r;
  const jr = await tx.one<{ id: string }>(
    `INSERT INTO finance.journals(tenant_id, legal_entity_id, ref, posting_date, currency, source_type, source_id, description, reverses_journal_id, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [ctx.tenantId, j.legalEntityId, ref, j.postingDate, j.currency, j.sourceType, j.sourceId, j.description, j.reversesJournalId ?? null, ctx.userId]);
  for (const l of j.lines) {
    await tx.q(`INSERT INTO finance.journal_lines(tenant_id, journal_id, account_id, debit, credit, party_id, job_id, memo)
                SELECT $1,$2,a.id,$4,$5,$6,$7,$8 FROM finance.accounts a WHERE a.legal_entity_id=$3 AND a.system_key=$9`,
      [ctx.tenantId, jr.id, j.legalEntityId, l.debit, l.credit, l.partyId ?? null, l.jobId ?? null, l.memo ?? null, l.account]);
  }
  return jr.id;
}
