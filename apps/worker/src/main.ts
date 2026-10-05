import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { makePool } from './db';
import { EVENTS_QUEUE, relayOutbox } from './relay';
import { handleEvent, resumeDueRuns } from './handlers';
import { pickScanner } from './scanner';

const { scanner, name: scannerName } = pickScanner();

const pool = makePool();
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const queue = new Queue(EVENTS_QUEUE, { connection });
const worker = new Worker(EVENTS_QUEUE, async (job) => handleEvent(pool, scanner, job.data), { connection, concurrency: 8 });
worker.on('failed', (j, err) => console.error('event failed', j?.id, err.message));
let busy = false;                                                   // a slow tick must never overlap the next one
const tick = async () => { if (busy) return; busy = true; try { await relayOutbox(pool, queue); await resumeDueRuns(pool); } catch (e) { console.error('relay error', e); } finally { busy = false; } };
const timer = setInterval(tick, 1000);
console.log(`DigitalBurj worker running (outbox relay + event consumers + workflow timers) · document scanner: ${scannerName}`);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { clearInterval(timer); await worker.close(); await queue.close(); await pool.end(); process.exit(0); });
