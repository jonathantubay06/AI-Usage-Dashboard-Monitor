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

const levelOf = (rule, pct) => (pct >= 100 ? 'over' : pct >= (rule.warnAt || 80) ? 'warn' : 'ok');
const metricOf = (rule, t) => (rule.metric === 'tokens' ? t.in + t.out + t.cacheRead + t.cacheWrite : t.cost || 0);

// "Watch each session": every session active in the last 24 hours whose total (all time) is over the limit,
// worst first. Idle chats drop out, so the warning clears once a runaway chat is closed.
export function sessionsOver(rule, sessions = []) {
  return sessions
    .filter((s) => s.last > Date.now() - 864e5 && (!rule.app || s.app === rule.app))
    .map((s) => { const used = metricOf(rule, s), pct = rule.limit > 0 ? (used / rule.limit) * 100 : 0; return { key: s.key, id: s.id, app: s.app, title: s.title, last: s.last, used, pct, level: levelOf(rule, pct) }; })
    .filter((s) => s.level !== 'ok')
    .sort((a, b) => b.used - a.used);
}

// Usage for one rule from the daily rows (or, for per-session rules, the sessions) of a snapshot.
export function evaluate(rule, daily, sessions) {
  if (rule.perSession) {
    const hot = sessionsOver(rule, sessions), top = hot[0];
    const used = top?.used || 0, pct = rule.limit > 0 ? (used / rule.limit) * 100 : 0;
    return { id: rule.id, name: rule.name, app: rule.app, model: '', perSession: true, used, limit: rule.limit, pct, level: top ? top.level : 'ok', period: rule.period, metric: rule.metric, from: 'all',
      top: top && { key: top.key, id: top.id, app: top.app, title: top.title }, count: hot.length };
  }
  const from = periodStart(rule.period);
  let used = 0;
  for (const r of daily) {
    if (r.day < from) continue;
    if (rule.app && r.app !== rule.app) continue;
    if (rule.model && r.model !== rule.model) continue;
    used += rule.metric === 'tokens' ? r.in + r.out + r.cacheRead + r.cacheWrite : r.cost;
  }
  const pct = rule.limit > 0 ? (used / rule.limit) * 100 : 0;
  const level = levelOf(rule, pct);
  return { id: rule.id, name: rule.name, app: rule.app, model: rule.model, used, limit: rule.limit, pct, level, period: rule.period, metric: rule.metric, from };
}

export function message(rule, st) {
  const amount = (v) => (rule.metric === 'tokens' ? `${(v / 1e6).toFixed(1)}M tokens` : `$${v.toFixed(2)}`);
  const what = [rule.app, rule.model].filter(Boolean).join(' / ') || 'All AI tools';
  const head = st.level === 'over' ? 'Over budget' : st.level === 'warn' ? 'Budget warning' : 'Test alert';
  // Webhooks may go to public services (ntfy.sh), so a per-session message never contains the chat title.
  if (rule.perSession) return `${head}: ${rule.name}: ${st.app || 'a'} session ${String(st.id || '').slice(0, 6)} is at ${amount(st.used)} of ${amount(rule.limit)} (${Math.round(st.pct)}%).`;
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
  return async function run(rules, daily, sessions = []) {
    const out = [];
    let changed = false;
    const fire = (rule, st, key) => {
      if (sent[key]) return;
      sent[key] = Date.now();
      changed = true;
      sendWebhook(rule, message(rule, st)).then((r) => !r.ok && console.warn(`[alerts] ${rule.name}: ${r.note}`));
    };
    for (const rule of rules.filter((r) => r.enabled !== false)) {
      const st = evaluate(rule, daily, sessions);
      out.push(st);
      if (st.level === 'ok' || !rule.webhook) continue;
      // At most 5 per pass, so a new rule never floods the phone.
      if (rule.perSession) { for (const s of sessionsOver(rule, sessions).slice(0, 5)) fire(rule, { ...s, level: s.level }, `${rule.id}|${s.key}|${s.level}`); continue; }
      fire(rule, st, `${rule.id}|${st.from}|${st.level}`);
    }
    if (changed) {
      const cutoff = Date.now() - 40 * 864e5;
      for (const [k, t] of Object.entries(sent)) if (t < cutoff) delete sent[k];
      await writeFile(file, JSON.stringify(sent));
    }
    return out;
  };
}
