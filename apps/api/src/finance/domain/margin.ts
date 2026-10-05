import { D } from '@dbl/contracts';
export interface MarginInput { quoted: { revenue: string; cost: string }; revenueCharges: string; costCharges: string; postedRevenue: string; postedCost: string; cashCollected: string }
/** Four margins are reported SEPARATELY: quoted, expected, accounting, cash. Never blended. */
export function margins(i: MarginInput) {
  const pct = (rev: any, cost: any) => (D(rev).isZero() ? null : D(rev).minus(cost).div(rev).mul(100).toDecimalPlaces(1).toFixed(1));
  return {
    quoted: { amount: D(i.quoted.revenue).minus(i.quoted.cost).toFixed(2), percent: pct(i.quoted.revenue, i.quoted.cost) },
    expected: { amount: D(i.revenueCharges).minus(i.costCharges).toFixed(2), percent: pct(i.revenueCharges, i.costCharges) },
    accounting: { amount: D(i.postedRevenue).minus(i.postedCost).toFixed(2), percent: pct(i.postedRevenue, i.postedCost) },
    cash: { collected: D(i.cashCollected).toFixed(2) },
  };
}
