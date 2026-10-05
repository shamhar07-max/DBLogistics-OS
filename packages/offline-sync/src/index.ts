/**
 * Offline command queue for driver / warehouse devices.
 * - Every command has a client-generated unique id (the server dedupes on it).
 * - Commands persist in a local store (SQLite on device) BEFORE being attempted.
 * - Device time and observed record version travel with the command; server receipt time is recorded separately by the server.
 * - Server verdicts: accepted | rejected | conflict. Conflicts surface in a queue for a human; they are never silently dropped.
 */
export type CommandType = 'capture_pod' | 'scan_count' | 'attach_photo';
export interface PendingCommand { commandId: string; type: CommandType; payload: Record<string, unknown>; deviceTime: string; observedVersion?: number; attempts: number; status: 'pending' | 'accepted' | 'rejected' | 'conflict'; lastError?: string }
export interface SqlStore { // thin port over expo-sqlite / better-sqlite3 / in-memory
  load(): Promise<PendingCommand[]>; save(cmds: PendingCommand[]): Promise<void>;
  getCursor(): Promise<string | null>; setCursor(c: string): Promise<void>;
}
export interface SyncTransport { send(deviceId: string, cmds: Array<Pick<PendingCommand, 'commandId' | 'type' | 'payload' | 'deviceTime' | 'observedVersion'>>): Promise<Array<{ commandId: string; status: 'accepted' | 'rejected' | 'conflict'; error?: string; message?: string }>> }

const uuid = () => (globalThis.crypto?.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (Math.random() * 16) | 0; return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16); }));

export class OfflineQueue {
  private cmds: PendingCommand[] = []; private loaded = false; private flushing: Promise<FlushResult> | null = null;
  constructor(private store: SqlStore, private transport: SyncTransport, private deviceId: string, private now: () => Date = () => new Date()) {}
  private async ensure() { if (!this.loaded) { this.cmds = await this.store.load(); this.loaded = true; } }
  async enqueue(type: CommandType, payload: Record<string, unknown>, observedVersion?: number): Promise<string> {
    await this.ensure(); const c: PendingCommand = { commandId: uuid(), type, payload, deviceTime: this.now().toISOString(), observedVersion, attempts: 0, status: 'pending' };
    this.cmds.push(c); await this.store.save(this.cmds); return c.commandId;
  }
  async pending() { await this.ensure(); return this.cmds.filter((c) => c.status === 'pending'); }
  async conflicts() { await this.ensure(); return this.cmds.filter((c) => c.status === 'conflict' || c.status === 'rejected'); }
  /** Safe to call repeatedly / concurrently: one flush at a time; re-sending an already-applied command is harmless (server replays its verdict). */
  flush(): Promise<FlushResult> { return (this.flushing ??= this.doFlush().finally(() => { this.flushing = null; })); }
  private async doFlush(): Promise<FlushResult> {
    await this.ensure(); const batch = this.cmds.filter((c) => c.status === 'pending').slice(0, 100); const r: FlushResult = { accepted: 0, rejected: 0, conflict: 0, failed: false };
    if (!batch.length) return r;
    for (const c of batch) c.attempts++;
    await this.store.save(this.cmds);                                  // attempts persisted before the network call (crash-safe)
    try {
      const res = await this.transport.send(this.deviceId, batch.map(({ commandId, type, payload, deviceTime, observedVersion }) => ({ commandId, type, payload, deviceTime, observedVersion })));
      for (const v of res) { const c = this.cmds.find((x) => x.commandId === v.commandId); if (!c) continue; c.status = v.status; c.lastError = v.error ? `${v.error}: ${v.message ?? ''}` : undefined; r[v.status]++; }
    } catch { r.failed = true; }                                        // network error: commands stay pending for the next attempt
    this.cmds = this.cmds.filter((c) => c.status !== 'accepted');       // accepted commands leave the queue; rejected/conflict stay visible
    await this.store.save(this.cmds); return r;
  }
}
export interface FlushResult { accepted: number; rejected: number; conflict: number; failed: boolean }
export class MemoryStore implements SqlStore {
  data: PendingCommand[] = []; cursor: string | null = null;
  async load() { return JSON.parse(JSON.stringify(this.data)); } async save(c: PendingCommand[]) { this.data = JSON.parse(JSON.stringify(c)); }
  async getCursor() { return this.cursor; } async setCursor(c: string) { this.cursor = c; }
}
