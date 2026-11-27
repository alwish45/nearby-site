// Lets `node --test tests/` run every *.test.mjs file in this folder
// (Node treats a folder argument as a module, and this is its entry point).
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
for (const f of readdirSync(here).filter(f => f.endsWith('.test.mjs')).sort()) await import(join(here, f));
