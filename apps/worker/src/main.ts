import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { makePool } from './db';
import { EVENTS_QUEUE, relayOutbox } from './relay';
import { handleEvent, resumeDueRuns, type ScanPort } from './handlers';

const eicar = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR';
const defaultScanner: ScanPort = { async scan() { return 'clean'; } };   // replace with ClamAV adapter in deployed environments

const pool = makePool();
const connection = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
const queue = new Queue(EVENTS_QUEUE, { connection });
const worker = new Worker(EVENTS_QUEUE, async (job) => handleEvent(pool, defaultScanner, job.data), { connection, concurrency: 8 });
worker.on('failed', (j, err) => console.error('event failed', j?.id, err.message));
const tick = async () => { try { await relayOutbox(pool, queue); await resumeDueRuns(pool); } catch (e) { console.error('relay error', e); } };
const timer = setInterval(tick, 1000);
console.log('DigitalBurj worker running (outbox relay + event consumers + workflow timers)');
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { clearInterval(timer); await worker.close(); await queue.close(); await pool.end(); process.exit(0); });
void eicar;
