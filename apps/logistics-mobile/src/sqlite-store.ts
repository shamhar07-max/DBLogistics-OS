import * as SQLite from 'expo-sqlite';
import type { PendingCommand, SqlStore } from '@dbl/offline-sync';

/** On-device persistence for the offline queue. Commands are written BEFORE any network attempt, so a crash never loses evidence. */
export class SqliteStore implements SqlStore {
  private dbp = SQLite.openDatabaseAsync('dbl-offline.db').then(async (db) => { await db.execAsync(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS cmd (command_id TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT);`); return db; });
  async load(): Promise<PendingCommand[]> { const db = await this.dbp; return (await db.getAllAsync<{ body: string }>('SELECT body FROM cmd')).map((r) => JSON.parse(r.body)); }
  async save(cmds: PendingCommand[]) { const db = await this.dbp; await db.withTransactionAsync(async () => { await db.runAsync('DELETE FROM cmd'); for (const c of cmds) await db.runAsync('INSERT INTO cmd(command_id, body) VALUES (?,?)', c.commandId, JSON.stringify(c)); }); }
  async getCursor() { const db = await this.dbp; return (await db.getFirstAsync<{ v: string }>("SELECT v FROM kv WHERE k='cursor'"))?.v ?? null; }
  async setCursor(c: string) { const db = await this.dbp; await db.runAsync("INSERT OR REPLACE INTO kv(k,v) VALUES ('cursor',?)", c); }
}
