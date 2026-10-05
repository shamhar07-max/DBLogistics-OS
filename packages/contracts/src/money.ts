import Decimal from 'decimal.js';
import { z } from 'zod';

/** Money crosses the wire as a decimal STRING and is computed with decimal arithmetic — never floats. */
export const MoneyString = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'decimal string with up to 4 places');
export const CurrencyCode = z.string().regex(/^[A-Z]{3}$/);
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export const D = (v: Decimal.Value) => new Decimal(v);
/** Round to a currency's minor units (policy: ROUND_HALF_UP, per line then summed). */
export const roundMoney = (v: Decimal.Value, minorUnits = 2) => new Decimal(v).toDecimalPlaces(minorUnits, Decimal.ROUND_HALF_UP);
export const money = (v: Decimal.Value, minorUnits = 2) => roundMoney(v, minorUnits).toFixed(minorUnits);
export const TAX_RATES: Record<string, string> = { SR5: '0.05', ZR: '0', EX: '0', OOS: '0' };
export const taxFor = (net: Decimal.Value, code: string, minorUnits = 2) => roundMoney(D(net).mul(TAX_RATES[code] ?? '0'), minorUnits);
