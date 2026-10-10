import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/main.ts'], format: ['esm'], target: 'node22', sourcemap: true, clean: true, banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" }, noExternal: [/^@dbl\//] });
