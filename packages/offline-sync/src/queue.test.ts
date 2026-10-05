import { describe, expect, it } from 'vitest';
import { MemoryStore, OfflineQueue, type SyncTransport } from './index';

/** A fake server with the SAME contract as POST /device/commands: unique commandId → one effect; replays return the stored verdict. */
function fakeServer() { const seen = new Map<string, any>(); let applied = 0; const t: SyncTransport & { down: boolean; applied: () => number } = { down: false, applied: () => applied,
  async send(_d, cmds) { if (t.down) throw new Error('offline'); return cmds.map((c) => { if (seen.has(c.commandId)) return seen.get(c.commandId); const v = (c.payload as any).conflict ? { commandId: c.commandId, status: 'conflict' as const, error: 'INVALID_STATE_TRANSITION' } : { commandId: c.commandId, status: 'accepted' as const }; if (v.status === 'accepted') applied++; seen.set(c.commandId, v); return v; }); } }; return t; }

describe('offline queue', () => {
  it('keeps commands while offline, delivers once when back, and survives restarts', async () => {
    const store = new MemoryStore(); const server = fakeServer(); let q = new OfflineQueue(store, server, 'dev-1');
    await q.enqueue('capture_pod', { tripStopId: 's1' }); await q.enqueue('scan_count', { sku: 'A', qty: 3 });
    server.down = true; expect((await q.flush()).failed).toBe(true); expect(await q.pending()).toHaveLength(2);
    q = new OfflineQueue(store, server, 'dev-1');                          // app killed and restarted: queue reloaded from storage
    expect(await q.pending()).toHaveLength(2); server.down = false;
    expect(await q.flush()).toMatchObject({ accepted: 2, failed: false }); expect(server.applied()).toBe(2); expect(await q.pending()).toHaveLength(0);
  });
  it('duplicate delivery (lost response) has one effect', async () => {
    const store = new MemoryStore(); const server = fakeServer(); const q = new OfflineQueue(store, server, 'dev-1'); await q.enqueue('capture_pod', { tripStopId: 's1' });
    const saved = JSON.parse(JSON.stringify(store.data)); await q.flush(); expect(server.applied()).toBe(1);
    store.data = saved; const q2 = new OfflineQueue(store, server, 'dev-1'); await q2.flush();       // device never learned the first attempt succeeded
    expect(server.applied()).toBe(1);
  });
  it('conflicts stay visible for a human; concurrent flushes coalesce', async () => {
    const store = new MemoryStore(); const server = fakeServer(); const q = new OfflineQueue(store, server, 'dev-1'); await q.enqueue('capture_pod', { conflict: true }); await q.enqueue('attach_photo', {});
    const [a, b] = await Promise.all([q.flush(), q.flush()]); expect(a).toBe(b);
    expect((await q.conflicts()).map((c) => c.status)).toEqual(['conflict']); expect(await q.pending()).toHaveLength(0);
  });
});
