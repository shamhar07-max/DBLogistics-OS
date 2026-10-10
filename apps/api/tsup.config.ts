import { cpSync } from 'node:fs';
import { defineConfig } from 'tsup';
// @dbl/documents is bundled into dist/main.js, so its fonts and the master logo are copied next to the bundle.
export default defineConfig({ entry: ['src/main.ts'], format: ['esm'], target: 'node22', sourcemap: true, clean: true,
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, noExternal: [/^@dbl\//], external: ['@nestjs/microservices', '@nestjs/websockets', 'class-validator', 'class-transformer'],
  onSuccess: async () => { for (const d of ['fonts', 'assets']) cpSync(`../../packages/documents/${d}`, `dist/${d}`, { recursive: true }); } });
