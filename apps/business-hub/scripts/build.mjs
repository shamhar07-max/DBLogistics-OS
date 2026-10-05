import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';
mkdirSync('dist', { recursive: true });
await build({ entryPoints: ['src/index.ts'], bundle: true, minify: true, format: 'esm', target: 'es2022', platform: 'neutral', mainFields: ['module', 'main'], outfile: 'dist/worker.mjs', legalComments: 'none', supported: { 'template-literal': false }, logLevel: 'info' });
console.log('worker.mjs', (statSync('dist/worker.mjs').size / 1024).toFixed(1), 'KB');
