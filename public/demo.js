// Demo mode: invented usage so the dashboard can be shown publicly (e.g. on Netlify).
// No real logs, paths, titles or keys are involved; everything below is generated.
let seed = 42;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const PRICES = { // USD per million tokens: input, output, cache read, cache write
  'claude-opus-5-5': [4, 20, 0.2, 5], 'claude-sonnet-5-5': [2, 10, 0.1, 2.5], 'claude-haiku-5-5': [0.8, 4, 0.08, 1],
  'gpt-6-luna': [0.1, 0.5, 0.01, 0.125], 'big-pickle': [0, 0, 0, 0], 'qwen3.5-9b': [0, 0, 0, 0],
};
const APPS = {
  'Claude Code': ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'],
  Codex: ['gpt-6-luna'],
  'LM Studio': ['qwen3.5-9b'],
};
const TITLES = ['Refactor auth middleware', 'Fix flaky checkout test', 'Landing page redesign', 'Write onboarding docs', 'Migrate to Postgres 17',
  'Add CSV export', 'Debug memory leak in worker', 'Set up CI pipeline', 'API rate limit handling', 'Build settings page', 'Draft release notes',
  'Image resize service', 'Investigate slow query', 'Dark mode polish', 'Webhook retries', 'Mobile nav bug', 'Add unit tests for parser', 'Price list cleanup'];
const PROJECTS = ['~/projects/acme-web', '~/projects/api-gateway', '~/projects/mobile-app', '~/projects/docs-site', '~/projects/data-tools'];

const cost = (model, t) => { const p = PRICES[model]; return (t.in * p[0] + t.out * p[1] + t.cacheRead * p[2] + t.cacheWrite * p[3]) / 1e6; };
function call(app, model, ts, session) {
  const big = app === 'Claude Code';
  const t = {
    in: Math.round(rnd() * (big ? 40 : 3000)), out: Math.round(200 + rnd() * (big ? 1800 : 900)),
    cacheRead: big ? Math.round(30000 + rnd() * 160000) : app === 'Codex' ? Math.round(rnd() * 40000) : 0,
    cacheWrite: big ? Math.round(rnd() * 9000) : 0, reasoning: 0,
  };
  if (app === 'LM Studio') t.in = Math.round(1500 + rnd() * 9000);
  return { ts, app, model, session, ...t, cost: cost(model, t) };
}

export function createDemo() {
  const daily = new Map(), hourly = new Map(), sessions = new Map(), recent = [];
  const blank = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, calls: 0, unpriced: 0 });
  const add = (o, r) => { for (const k of ['in', 'out', 'cacheRead', 'cacheWrite', 'reasoning', 'cost']) o[k] += r[k]; o.calls++; };
  let version = 0;
  function push(r) {
    const day = new Date(r.ts).toLocaleDateString('en-CA');
    const dk = `${day}|${r.app}|${r.model}`;
    if (!daily.has(dk)) daily.set(dk, { day, app: r.app, model: r.model, ...blank() });
    add(daily.get(dk), r);
    if (r.ts > Date.now() - 48 * 3600e3) {
      const h = Math.floor(r.ts / 3600e3) * 3600e3, hk = `${h}|${r.app}`;
      if (!hourly.has(hk)) hourly.set(hk, { hour: h, app: r.app, ...blank() });
      add(hourly.get(hk), r);
    }
    const s = sessions.get(`${r.app}:${r.session}`);
    add(s, r); s.last = Math.max(s.last, r.ts); s.first = Math.min(s.first, r.ts);
    recent.unshift(r); recent.length = Math.min(recent.length, 60);
    version++;
  }
  function newSession(app, ts) {
    const id = Math.floor(rnd() * 1e9).toString(16);
    const s = { key: `${app}:${id}`, app, id, title: pick(TITLES), project: pick(PROJECTS), model: pick(APPS[app]), first: ts, last: ts, ...blank() };
    sessions.set(s.key, s);
    return s;
  }
  // 45 days of history with a weekday rhythm
  const now = Date.now();
  for (let d = 44; d >= 0; d--) {
    const base = new Date(now - d * 864e5); base.setHours(8, 0, 0, 0);
    const weekend = [0, 6].includes(base.getDay());
    for (const app of Object.keys(APPS)) {
      const nSessions = Math.round((weekend ? 0.6 : 1.6) * (app === 'Claude Code' ? 4 : 1.5) * (0.4 + rnd()));
      for (let i = 0; i < nSessions; i++) {
        const s = newSession(app, base.getTime());
        const calls = Math.round((app === 'Claude Code' ? 40 : 15) * (0.3 + rnd()));
        let ts = base.getTime() + rnd() * 10 * 3600e3;
        for (let c = 0; c < calls && ts < now; c++, ts += rnd() * 90e3) push(call(app, s.model, ts, s.id));
      }
    }
  }
  const live = Object.values(Object.fromEntries([...sessions].filter(([, s]) => s.app === 'Claude Code').slice(-2)));

  return {
    snapshot: () => ({
      version, generatedAt: Date.now(), daily: [...daily.values()], hourly: [...hourly.values()],
      sessions: [...sessions.values()].filter((s) => s.calls), recent: recent.slice(0, 60),
      limits: { Codex: { primary: { percent: 23, windowMinutes: 300, resetsAt: now + 3.2 * 3600e3 }, secondary: { percent: 41, windowMinutes: 10080, resetsAt: now + 4 * 864e5 }, updated: now - 120e3 } },
    }),
    tick() { // a new call every few seconds, like a real busy session
      const s = pick(live);
      push(call(s.app, s.model, Date.now(), s.id));
    },
    live: () => [
      { id: 'g', name: 'GPU', type: 'gpu', ok: true, gpu: { util: Math.round(55 + rnd() * 40), vramGB: +(9 + rnd() * 2).toFixed(1), vramTotalGB: 16 } },
      { id: 'o', name: 'Ollama', type: 'ollama', ok: true, note: 'Model loaded', models: [{ name: 'qwen3.5:9b', vramGB: 6.8 }] },
      { id: 'l', name: 'LM Studio', type: 'openai-compatible', ok: true, note: 'Up', models: [{ name: 'qwen3.5-9b' }],
        rates: { decode: 60 + rnd() * 40, prefill: 900 + rnd() * 9000, running: 1, queued: 0, kv: 0.15 + rnd() * 0.3 } },
    ],
  };
}

// Same rule check as src/alerts.js, run in the browser because the demo has no server.
export function evaluate(rule, daily, sessions = []) {
  if (rule.perSession) {
    const val = (s) => (rule.metric === 'tokens' ? s.in + s.out + s.cacheRead + s.cacheWrite : s.cost);
    const hot = sessions.filter((s) => s.last > Date.now() - 864e5 && (!rule.app || s.app === rule.app)).map((s) => ({ s, used: val(s) }))
      .map((x) => ({ ...x, pct: rule.limit > 0 ? (x.used / rule.limit) * 100 : 0 })).filter((x) => x.pct >= (rule.warnAt || 80)).sort((a, b) => b.used - a.used);
    const top = hot[0];
    return { id: rule.id, name: rule.name, app: rule.app, perSession: true, used: top?.used || 0, limit: rule.limit, pct: top?.pct || 0, level: !top ? 'ok' : top.pct >= 100 ? 'over' : 'warn',
      period: rule.period, metric: rule.metric, from: 'all', top: top && { key: top.s.key, id: top.s.id, app: top.s.app, title: top.s.title }, count: hot.length };
  }
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (rule.period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (rule.period === 'month') d.setDate(1);
  const from = d.toLocaleDateString('en-CA');
  let used = 0;
  for (const r of daily) {
    if (r.day < from || (rule.app && r.app !== rule.app) || (rule.model && r.model !== rule.model)) continue;
    used += rule.metric === 'tokens' ? r.in + r.out + r.cacheRead + r.cacheWrite : r.cost;
  }
  const pct = rule.limit > 0 ? (used / rule.limit) * 100 : 0;
  const level = pct >= 100 ? 'over' : pct >= (rule.warnAt || 80) ? 'warn' : 'ok';
  return { id: rule.id, name: rule.name, app: rule.app, model: rule.model, used, limit: rule.limit, pct, level, period: rule.period, metric: rule.metric, from };
}

export const demoSources = [
  { id: 'd1', type: 'claude-code', name: 'Claude Code', enabled: true, path: '~/.claude/projects' },
  { id: 'd2', type: 'codex', name: 'Codex', enabled: true, path: '~/.codex/sessions' },
  { id: 'd4', type: 'openai-compatible', name: 'LM Studio', enabled: true, url: 'http://127.0.0.1:1234' },
  { id: 'd5', type: 'ollama', name: 'Ollama', enabled: true, url: 'http://127.0.0.1:11434' },
  { id: 'd6', type: 'gpu', name: 'GPU', enabled: true },
];
export const demoAlerts = [
  { id: 'a1', name: 'Daily Claude budget', enabled: true, app: 'Claude Code', model: '', period: 'day', metric: 'cost', limit: 3, warnAt: 80, browser: true, webhook: '', webhookFormat: 'ntfy' },
  { id: 'a3', name: 'Any single chat over $2', enabled: true, app: '', model: '', period: 'day', metric: 'cost', limit: 2, warnAt: 80, perSession: true, browser: false, webhook: '', webhookFormat: 'ntfy' },
  { id: 'a2', name: 'Monthly total', enabled: true, app: '', model: '', period: 'month', metric: 'cost', limit: 1500, warnAt: 75, browser: false, webhook: '', webhookFormat: 'ntfy' },
];
