// Copies brand assets into public/: the MASTER LOGO (unmodified), self-hosted fonts and tokens. Generated files are git-ignored.
import { mkdirSync, copyFileSync, readdirSync, writeFileSync, readFileSync } from 'node:fs';
const root = new URL('../../../brand/', import.meta.url); const pub = new URL('../public/', import.meta.url);
mkdirSync(new URL('fonts/', pub), { recursive: true });
copyFileSync(new URL('assets/logo/digitalburj-logistics-os-logo.png', root), new URL('logo.png', pub));
copyFileSync(new URL('assets/logo/favicon.ico', root), new URL('favicon.ico', pub));
for (const f of readdirSync(new URL('fonts/', root)).filter((f) => f.endsWith('.woff2'))) copyFileSync(new URL(`fonts/${f}`, root), new URL(`fonts/${f}`, pub));
writeFileSync(new URL('fonts.css', pub), readFileSync(new URL('fonts/fonts.css', root), 'utf8').replace(/url\(([^)]+\.woff2)\)/g, 'url(/fonts/$1)'));
console.log('assets copied');
