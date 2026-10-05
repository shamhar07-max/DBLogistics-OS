// Single source of truth = brand/tokens. This copies the CSS (without the font @import path) so apps can import "@dbl/design-tokens/tokens.css".
import { readFileSync, writeFileSync } from 'node:fs';
const css = readFileSync(new URL('../../../brand/tokens/tokens.css', import.meta.url), 'utf8').replace(/@import url\("\.\.\/fonts\/fonts\.css"\);\n?/, '');
writeFileSync(new URL('../src/tokens.css', import.meta.url), css);
console.log('tokens.css synced');
