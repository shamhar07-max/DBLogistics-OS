import { z } from 'zod';
import { CurrencyCode, D, MoneyString } from './money';
import { Uuid } from './schemas';

const Amount = MoneyString.refine(v => D(v).gte(0) && D(v).lt('50000000000000'), 'Non-negative amount below 50 trillion required');
export const CreateRfqBody = z.object({
  legalEntityId: Uuid, mode: z.enum(['ocean_fcl','ocean_lcl','air','road','multimodal','warehouse','customs']),
  origin: z.string().trim().min(2).max(200), destination: z.string().trim().min(2).max(200),
  requirements: z.string().trim().min(10).max(10000), currency: CurrencyCode,
  responseDeadline: z.string().datetime({ offset: true }),
  supplierPartyIds: z.array(Uuid).min(1).max(50).refine(v => new Set(v).size === v.length, 'Invite each supplier once'),
}).strict();
export const RecordRfqOfferBody = z.object({
  supplierPartyId: Uuid, freight: Amount, localCharges: Amount,
  transitDays: z.number().int().min(0).max(3650), freeDays: z.number().int().min(0).max(3650),
  validUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => { const d = new Date(v); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === v; }, 'Valid calendar date required'),
  terms: z.string().trim().min(10).max(10000),
}).strict();
export const AwardRfqBody = z.object({ offerId: Uuid, reason: z.string().trim().min(10).max(4000) }).strict();
