/** Lifecycle catalog — the only legal transitions. Commands, never generic status edits. */
export const SHIPMENT_TRANSITIONS: Record<string, string[]> = { planned: ['executing', 'delivered', 'cancelled'], executing: ['delivered', 'cancelled'], delivered: [], cancelled: [] };
export const BOOKING_TRANSITIONS: Record<string, string[]> = { requested: ['confirmed', 'cancelled'], confirmed: ['amended', 'cancelled'], amended: ['confirmed', 'cancelled'], cancelled: [] };
export const canShipment = (a: string, b: string) => SHIPMENT_TRANSITIONS[a]?.includes(b) ?? false;
export const canBooking = (a: string, b: string) => BOOKING_TRANSITIONS[a]?.includes(b) ?? false;
export interface TimelineEvent { code: string; event_time: string | Date; is_actual: boolean; source: string; received_at: string | Date }
/** Current milestone = latest ACTUAL event by event_time (not by arrival order) so late events cannot corrupt state. */
export function currentMilestone(events: TimelineEvent[]) {
  const actual = events.filter((e) => e.is_actual).sort((a, b) => +new Date(b.event_time) - +new Date(a.event_time));
  return actual[0]?.code ?? null;
}
