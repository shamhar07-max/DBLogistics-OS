/** Field extraction from OCR / text-layer output of trade documents. Pure functions: everything returned is a *suggestion* for a human, never authoritative. */

/** ISO 6346 check digit: letters map skipping multiples of 11, weights 2^position, mod 11, mod 10. */
export function iso6346Valid(code: string): boolean {
  if (!/^[A-Z]{3}[UJZR]\d{7}$/.test(code)) return false;
  let n = 10; const vals: Record<string, number> = {};
  for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') { if (n % 11 === 0) n++; vals[ch] = n++; }
  let sum = 0;
  for (let i = 0; i < 10; i++) { const c = code[i]!; sum += (i < 4 ? vals[c]! : Number(c)) * 2 ** i; }
  return ((sum % 11) % 10) === Number(code[10]);
}

const INCOTERMS = ['EXW', 'FCA', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP', 'FAS', 'FOB', 'CFR', 'CIF'];
const CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR', 'INR', 'CNY', 'JPY', 'OMR', 'QAR', 'KWD', 'BHD'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export interface ExtractedFields {
  containerNumbers: { value: string; checkDigitValid: boolean }[];
  hsCodes: string[]; amounts: { currency: string; value: number }[]; dates: string[];
  billOfLading?: string[]; airWaybill?: string[]; incoterm?: string; weightsKg: number[]; trn?: string[];
}

const num = (s: string) => Number(s.replace(/,/g, ''));
const uniq = <T,>(a: T[], key: (t: T) => string = (t) => String(t)) => { const seen = new Set<string>(); return a.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const pad = (n: number | string) => String(n).padStart(2, '0');

export function parseFields(text: string): ExtractedFields {
  const t = text.replace(/[‎‏]/g, '');
  const up = t.toUpperCase();
  const containerNumbers = uniq([...up.matchAll(/\b([A-Z]{3}[UJZR])[\s-]?(\d{6})[\s-]?(\d)\b/g)].map((m) => `${m[1]}${m[2]}${m[3]}`)).map((value) => ({ value, checkDigitValid: iso6346Valid(value) }));
  const hsCodes = uniq([...t.matchAll(/(?:\bHS\b[\s:#-]*(?:CODE)?[\s:#-]*|\bTARIFF[\s:#-]*)(\d{4}(?:[.\s]?\d{2}){0,3})/gi)].map((m) => m[1]!.replace(/[.\s]/g, '')).filter((v) => [4, 6, 8, 10].includes(v.length)));
  const amounts = uniq([
    ...[...up.matchAll(new RegExp(`\\b(${CURRENCIES.join('|')})\\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})?|[0-9]+(?:\\.[0-9]{1,2})?)\\b`, 'g'))].map((m) => ({ currency: m[1]!, value: num(m[2]!) })),
    ...[...up.matchAll(new RegExp(`\\b([0-9]{1,3}(?:,[0-9]{3})*(?:\\.[0-9]{1,2})|[0-9]+\\.[0-9]{2})\\s?(${CURRENCIES.join('|')})\\b`, 'g'))].map((m) => ({ currency: m[2]!, value: num(m[1]!) })),
  ], (a) => `${a.currency}${a.value}`);
  const dates: string[] = [];
  for (const m of t.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) dates.push(`${m[1]}-${m[2]}-${m[3]}`);
  for (const m of t.matchAll(/\b(\d{1,2})[\/.](\d{1,2})[\/.](20\d{2})\b/g)) { const d = Number(m[1]), mo = Number(m[2]); if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) dates.push(`${m[3]}-${pad(mo)}-${pad(d)}`); }
  for (const m of t.matchAll(/\b(\d{1,2})[\s-]([A-Za-z]{3})[a-z]*[\s,-]+(20\d{2})\b/g)) { const mo = MONTHS.indexOf(m[2]!.toLowerCase()); if (mo >= 0) dates.push(`${m[3]}-${pad(mo + 1)}-${pad(m[1]!)}`); }
  const bl = uniq([...t.matchAll(/\b(?:B\/?L|BILL OF LADING)(?:\s?(?:NO|NUMBER|#))?\.?[\s:#-]*([A-Z]{2,5}[A-Z0-9]{6,14})\b/gi)].map((m) => m[1]!.toUpperCase()).filter((v) => /\d/.test(v)));
  const awb = uniq([...t.matchAll(/\b(\d{3})[\s-](\d{4})[\s ]?(\d{4})\b/g)].filter((m) => Number(`${m[2]}${m[3]}`.slice(0, 7)) % 7 === Number(`${m[2]}${m[3]}`[7])).map((m) => `${m[1]}-${m[2]}${m[3]}`));
  const incoterm = INCOTERMS.find((i) => new RegExp(`\\b${i}\\b`).test(up));
  const weightsKg = uniq([...t.matchAll(/\b([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)\s?(KGS?|KILOGRAMS?|MT|TONS?|TONNES?)\b/gi)].map((m) => { const v = num(m[1]!); return /^(MT|TON)/i.test(m[2]!) ? v * 1000 : v; }));
  const trn = uniq([...t.matchAll(/\b(?:TRN|TAX REGISTRATION(?: NUMBER| NO)?)[\s:#.-]*(\d{15})\b/gi)].map((m) => m[1]!));
  const out: ExtractedFields = { containerNumbers, hsCodes, amounts, dates: uniq(dates), weightsKg };
  if (bl.length) out.billOfLading = bl; if (awb.length) out.airWaybill = awb; if (incoterm) out.incoterm = incoterm; if (trn.length) out.trn = trn;
  return out;
}
