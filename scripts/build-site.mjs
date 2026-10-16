// Builds a static site from public/:
//   node scripts/build-site.mjs          -> dist-demo/   public demo on invented data (no server, no logs, no config)
//   node scripts/build-site.mjs --cloud  -> dist-cloud/  your own read-only cloud copy (data comes from cloud/functions)
// Set SITE_URL (Netlify sets URL itself) so link previews get an absolute image address.
import { cp, rm, readFile, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as claude from '../src/sources/claude-code.js';
import * as codex from '../src/sources/codex.js';
import * as opencode from '../src/sources/opencode.js';
import { ollama, openaiCompatible, gpu, remote } from '../src/sources/live.js';
import { PERIODS, WEBHOOK_FORMATS } from '../src/alerts.js';
import { fetchRates } from '../src/currency.js';

const CLOUD = process.argv.includes('--cloud');
const SITE = (process.env.SITE_URL || process.env.URL || '').replace(/\/+$/, '');
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, CLOUD ? 'dist-cloud' : 'dist-demo');
await rm(out, { recursive: true, force: true });
await cp(join(root, 'public'), out, { recursive: true });

const html = await readFile(join(out, 'index.html'), 'utf8');
await writeFile(join(out, 'index.html'), html
  .replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta name="${CLOUD ? 'atm-cloud' : 'atm-demo'}" content="1">${CLOUD ? '\n  <meta name="robots" content="noindex, nofollow">' : ''}`)
  .replace(/content="\/(netlify-open-graph\.png)"/g, SITE ? `content="${SITE}/$1"` : 'content="/$1"')
  .replace(/(src|href)="\//g, '$1="./')); // relative paths so the site works from any folder

if (CLOUD) {
  await rm(join(out, 'demo.js'));
  console.log(`Cloud site built in ${out}`);
} else {
  const types = [claude, codex, opencode, ollama, openaiCompatible, gpu, remote].map((m) => m.info);
  await writeFile(join(out, 'demo-types.json'), JSON.stringify({ types, periods: PERIODS, webhookFormats: WEBHOOK_FORMATS }));
  // Exchange rates are public data: a snapshot at build time keeps the demo free of live calls.
  const rates = await fetchRates().catch((e) => { console.warn(`Rates unavailable (${e.message}); demo shows USD only`); return { base: 'USD', rates: { USD: 1 }, updated: 0 }; });
  await writeFile(join(out, 'demo-rates.json'), JSON.stringify(rates));
  console.log(`Demo built in ${out}`);
}
