import { defineConfig } from 'tsup';
export default defineConfig({ entry: ['src/main.ts'], format: ['esm'], target: 'node22', sourcemap: true, clean: true, noExternal: [/^@dbl\//], external: ['@nestjs/microservices', '@nestjs/websockets', 'class-validator', 'class-transformer'] });
