// Exchange rates (USD base) from the free open.er-api.com feed, cached in data/rates.json for 12 h.
// Costs are always stored in USD; the dashboard converts them for display only.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

export const RATES_URL = 'https://open.er-api.com/v6/latest/USD';
let rates = { base: 'USD', rates: { USD: 1 }, updated: 0 };

export async function loadRates(dataDir) {
  const file = join(dataDir, 'rates.json');
  try {
    const age = Date.now() - (await stat(file)).mtimeMs;
    rates = JSON.parse(await readFile(file, 'utf8'));
    if (age < 12 * 3600e3) return rates;
  } catch { /* no cache yet */ }
  try {
    rates = await fetchRates();
    await writeFile(file, JSON.stringify(rates));
  } catch (e) {
    console.warn(`[currency] could not refresh rates (${e.message}); showing ${Object.keys(rates.rates).length} cached`);
  }
  return rates;
}

export async function fetchRates() {
  const res = await fetch(RATES_URL, { signal: AbortSignal.timeout(10000) });
  const j = await res.json();
  if (j.result !== 'success') throw new Error(j['error-type'] || `HTTP ${res.status}`);
  return { base: 'USD', rates: j.rates, updated: j.time_last_update_unix * 1000 };
}

export const getRates = () => rates;
