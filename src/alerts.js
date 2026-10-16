// Budget alerts: user-defined rules ("Claude Code over $50 a day"), checked every 30 s.
// A rule notifies once per period per level (warning, then over budget).
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { dayKey } from './store.js';

export const PERIODS = { day: 'Today', week: 'This week (from Monday)', month: 'This month' };
export const WEBHOOK_FORMATS = {
  ntfy: 'ntfy.sh (phone push, plain text)',
  slack: 'Slack incoming webhook',
  discord: 'Discord webhook',
  json: 'Generic JSON POST',
};

export function periodStart(period, now = new Date()) {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (period === 'month') d.setDate(1);
  return dayKey(d);
}

// Usage for one rule from the daily rows of a snapshot.
export function evaluate(rule, daily) {
  const from = periodStart(rule.period);
  let used = 0;
  for (const r of daily) {
    if (r.day < from) continue;
    if (rule.app && r.app !== rule.app) continue;
    if (rule.model && r.model !== rule.model) continue;
    used += rule.metric === 'tokens' ? r.in + r.out + r.cacheRead + r.cacheWrite : r.cost;
  }
  const pct = rule.limit > 0 ? (used / rule.limit) * 100 : 0;
  const level = pct >= 100 ? 'over' : pct >= (rule.warnAt || 80) ? 'warn' : 'ok';
  return { id: rule.id, name: rule.name, app: rule.app, model: rule.model, used, limit: rule.limit, pct, level, period: rule.period, metric: rule.metric, from };
}

export function message(rule, st) {
  const amount = (v) => (rule.metric === 'tokens' ? `${(v / 1e6).toFixed(1)}M tokens` : `$${v.toFixed(2)}`);
  const what = [rule.app, rule.model].filter(Boolean).join(' / ') || 'All AI tools';
  const head = st.level === 'over' ? 'Over budget' : st.level === 'warn' ? 'Budget warning' : 'Test alert';
  return `${head}: ${rule.name} (${what}) is at ${amount(st.used)} of ${amount(rule.limit)} (${Math.round(st.pct)}%) for ${PERIODS[rule.period].toLowerCase()}.`;
}

export async function sendWebhook(rule, text) {
  const url = rule.webhook;
  if (!url) return { ok: false, note: 'No webhook URL set' };
  const fmt = rule.webhookFormat || 'json';
  const init = fmt === 'ntfy'
    ? { body: text, headers: { Title: 'AI Token Monitor', Tags: 'money_with_wings' } }
    : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fmt === 'slack' ? { text } : fmt === 'discord' ? { content: text } : { text, source: 'ai-token-monitor' }),
    };
  try {
    const res = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(8000), ...init });
    return { ok: res.ok, note: res.ok ? 'Sent' : `HTTP ${res.status}` };
  } catch (e) { return { ok: false, note: e.message }; }
}

// Fires webhooks on level changes; remembers what was sent in data/alert-state.json.
export function createAlertRunner(dataDir) {
  const file = join(dataDir, 'alert-state.json');
  let sent = {};
  readFile(file, 'utf8').then((t) => { sent = JSON.parse(t); }).catch(() => {});
  return async function run(rules, daily) {
    const out = [];
    let changed = false;
    for (const rule of rules.filter((r) => r.enabled !== false)) {
      const st = evaluate(rule, daily);
      out.push(st);
      if (st.level === 'ok' || !rule.webhook) continue;
      const key = `${rule.id}|${st.from}|${st.level}`;
      if (sent[key]) continue;
      sent[key] = Date.now();
      changed = true;
      sendWebhook(rule, message(rule, st)).then((r) => !r.ok && console.warn(`[alerts] ${rule.name}: ${r.note}`));
    }
    if (changed) {
      const cutoff = Date.now() - 40 * 864e5;
      for (const [k, t] of Object.entries(sent)) if (t < cutoff) delete sent[k];
      await writeFile(file, JSON.stringify(sent));
    }
    return out;
  };
}
