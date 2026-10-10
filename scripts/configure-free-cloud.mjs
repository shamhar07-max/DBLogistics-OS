import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const path = new URL('../infrastructure/free-cloud/.env', import.meta.url);
const template = await readFile(new URL('../infrastructure/free-cloud/.env.example', import.meta.url), 'utf8');
const content = template.replace(/^([A-Z_]+)=GENERATE$/gm, (_, name) => `${name}=${randomBytes(32).toString('hex')}`);
await writeFile(path, content, { flag: 'wx', mode: 0o600 });
console.log('Created private deployment configuration. Set domains, owner email, tunnel token and storage settings before deploying. Existing configuration is never overwritten.');
