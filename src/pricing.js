// API-equivalent prices from the public LiteLLM price list (the same source ccusage uses).
// Cached in data/prices.json, refreshed once a day. Unknown models stay unpriced (cost = null).
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const URL_PRICES = 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
let table = {};

export async function loadPrices(dataDir) {
  const file = join(dataDir, 'prices.json');
  try {
    const age = Date.now() - (await stat(file)).mtimeMs;
    table = JSON.parse(await readFile(file, 'utf8'));
    if (age < 24 * 3600e3) return;
  } catch { /* no cache yet */ }
  try {
    const res = await fetch(URL_PRICES, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    table = await res.json();
    await writeFile(file, JSON.stringify(table));
  } catch (e) {
    console.warn(`[pricing] could not refresh price list (${e.message}); using cache=${Object.keys(table).length > 0}`);
  }
}

const cache = new Map();
function lookup(model) {
  if (cache.has(model)) return cache.get(model);
  const bare = model.replace(/^.*\//, '');
  const candidates = [model, bare, `anthropic/${bare}`, `openai/${bare}`, bare.replace(/-\d{8}$/, '')];
  const hit = candidates.map((k) => table[k]).find((p) => p && p.input_cost_per_token != null) || null;
  cache.set(model, hit);
  return hit;
}

// Tokens -> USD. Returns null when the model is not in the price list.
export function priceOf(model, t) {
  const p = lookup(model);
  if (!p) return null;
  return t.in * (p.input_cost_per_token || 0)
    + (t.out + (t.reasoningBilledSeparately ? t.reasoning : 0)) * (p.output_cost_per_token || 0)
    + t.cacheRead * (p.cache_read_input_token_cost ?? p.input_cost_per_token ?? 0)
    + (t.cacheWrite - (t.cacheWrite1h || 0)) * (p.cache_creation_input_token_cost ?? p.input_cost_per_token ?? 0)
    + (t.cacheWrite1h || 0) * (p.cache_creation_input_token_cost_above_1hr ?? p.cache_creation_input_token_cost ?? 0);
}
