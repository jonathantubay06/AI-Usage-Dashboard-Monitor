// AI Token Monitor server.
// node src/server.js          -> http://127.0.0.1:7788 (this PC only)
// node src/server.js --lan    -> also reachable from phone / other devices; needs the access token
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { createStore } from './store.js';
import { expandHome } from './tail.js';
import { loadPrices } from './pricing.js';
import { loadRates, getRates } from './currency.js';
import { createCloudPusher } from './cloud.js';
import * as claude from './sources/claude-code.js';
import * as codex from './sources/codex.js';
import * as opencode from './sources/opencode.js';
import { ollama, openaiCompatible, gpu, remote } from './sources/live.js';
import { createAlertRunner, evaluate, message, sendWebhook, PERIODS, WEBHOOK_FORMATS } from './alerts.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.ATM_DATA || join(ROOT, 'data');
const PUBLIC = join(ROOT, 'public');
const args = process.argv.slice(2);
const LAN = args.includes('--lan');
const PORT = Number(process.env.PORT || args[args.indexOf('--port') + 1] || 7788) || 7788;

const TYPES = Object.fromEntries([claude, codex, opencode, ollama, openaiCompatible, gpu, remote]
  .map((m) => [m.info.type, m]));

// ---------- config ----------
await mkdir(DATA, { recursive: true });
const CONFIG_FILE = join(DATA, 'config.json');
let config;
try { config = JSON.parse(await readFile(CONFIG_FILE, 'utf8')); } catch { config = null; }
if (!config) {
  // First run: add every source whose default location exists on this machine.
  const sources = [];
  for (const t of ['claude-code', 'codex', 'opencode']) {
    const def = TYPES[t].info.fields[0].default;
    if (existsSync(expandHome(def))) sources.push({ id: randomUUID(), type: t, name: TYPES[t].info.label, enabled: true, path: def });
  }
  sources.push({ id: randomUUID(), type: 'ollama', name: 'Ollama', enabled: true, url: TYPES.ollama.info.fields[0].default });
  sources.push({ id: randomUUID(), type: 'gpu', name: 'GPU', enabled: true });
  config = { token: randomBytes(18).toString('base64url'), sources };
}
config.alerts ||= [];
config.cloud ||= { enabled: false, url: '', pushToken: '', includeTitles: false };
const saveConfig = () => writeFile(CONFIG_FILE, JSON.stringify(config, null, 2));
const publicAlert = (a) => ({ ...a, webhook: a.webhook ? '••••••' : '' });

// Alert rule from a request body. Unknown fields are dropped; numbers are validated.
function alertFrom(b, prev = {}) {
  const a = { ...prev };
  if (b.name != null) a.name = String(b.name).slice(0, 60) || 'Budget';
  for (const k of ['app', 'model']) if (b[k] != null) a[k] = String(b[k]).slice(0, 120);
  if (PERIODS[b.period]) a.period = b.period;
  if (['cost', 'tokens'].includes(b.metric)) a.metric = b.metric;
  if (b.limit != null) a.limit = Math.max(0, Number(b.limit) || 0);
  if (b.warnAt != null) a.warnAt = Math.min(100, Math.max(1, Number(b.warnAt) || 80));
  if (b.browser != null) a.browser = b.browser === true || b.browser === 'on' || b.browser === 'true';
  if (typeof b.enabled === 'boolean') a.enabled = b.enabled;
  if (b.perSession != null) a.perSession = b.perSession === true || b.perSession === 'on' || b.perSession === 'true';
  if (WEBHOOK_FORMATS[b.webhookFormat]) a.webhookFormat = b.webhookFormat;
  if (b.webhook != null && b.webhook !== '••••••') {
    const w = String(b.webhook).trim();
    if (w && !/^https?:\/\//.test(w)) throw new Error('Webhook must start with http:// or https://');
    a.webhook = w;
  }
  return a;
}
await saveConfig();

const publicSource = (s) => {
  const out = { ...s };
  for (const f of TYPES[s.type]?.info.fields || []) if (f.secret && out[f.key]) out[f.key] = '••••••';
  return out;
};

// ---------- runtime ----------
let store, running = [];
async function boot() {
  for (const r of running) r.inst.stop?.();
  store = createStore();
  running = [];
  const t0 = Date.now();
  for (const cfg of config.sources.filter((s) => s.enabled && TYPES[s.type])) {
    try {
      const mod = TYPES[cfg.type];
      const inst = (mod.create || mod.default?.create).call(mod, cfg, store);
      running.push({ cfg, inst });
      await inst.start?.();
    } catch (e) { console.warn(`[${cfg.name}] ${e.message}`); }
  }
  console.log(`[monitor] ${running.length} sources ready in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

function data() {
  const snap = store.snapshot();
  for (const { cfg, inst } of running) {
    const r = inst.snapshot?.();
    if (!r) continue;
    const tag = (app) => `${app} @ ${cfg.name}`;
    snap.daily.push(...r.daily.map((d) => ({ ...d, app: tag(d.app) })));
    snap.hourly.push(...r.hourly.map((d) => ({ ...d, app: tag(d.app) })));
    snap.sessions.push(...r.sessions.map((d) => ({ ...d, app: tag(d.app), key: `${cfg.id}:${d.key}` })));
    for (const [k, v] of Object.entries(r.limits || {})) snap.limits[tag(k)] = v;
  }
  snap.alerts = config.alerts.filter((a) => a.enabled !== false).map((a) => ({ ...evaluate(a, snap.daily, snap.sessions), browser: a.browser }));
  return snap;
}
// Budget changes made on the phone; webhooks can only be set here on the PC.
async function applyCloudOps(ops, seq) {
  for (const o of ops) {
    const { webhook, webhookFormat, ...f } = o.fields || {};
    const i = config.alerts.findIndex((a) => a.id === o.id);
    if (o.op === 'add' && i < 0) config.alerts.push(alertFrom({ name: 'Budget', period: 'day', metric: 'cost', limit: 10, warnAt: 80, browser: false, app: '', model: '', ...f }, { id: o.id, enabled: true }));
    if (o.op === 'update' && i >= 0) config.alerts[i] = alertFrom(f, config.alerts[i]);
    if (o.op === 'delete' && i >= 0) config.alerts.splice(i, 1);
  }
  config.cloud.opsSeq = seq;
  await saveConfig();
  if (ops.length) console.log(`[cloud] applied ${ops.length} budget change(s) from the phone`);
}
const cloud = createCloudPusher({
  getConfig: () => config.cloud, getData: data, getLive: live, getRates,
  getAlerts: () => config.alerts, getMeta: () => ({ periods: PERIODS, webhookFormats: WEBHOOK_FORMATS }), applyOps: applyCloudOps,
});
// Usage is pushed within about 5 s of a change (plus a 5-minute heartbeat); phone edits are pulled every 5 s.
setInterval(() => cloud.push(), 5000);
setInterval(() => cloud.pull(), 5000);
const publicCloud = () => ({ ...config.cloud, pushToken: config.cloud.pushToken ? '••••••' : '', last: cloud.status() });
const runAlerts = createAlertRunner(DATA);
setInterval(() => runAlerts(config.alerts, data().daily, data().sessions).catch((e) => console.warn(`[alerts] ${e.message}`)), 30000);

async function live() {
  const out = [];
  for (const { cfg, inst } of running) {
    if (!inst.status) continue;
    try { out.push({ id: cfg.id, name: cfg.name, type: cfg.type, ...(await inst.status()) }); }
    catch (e) { out.push({ id: cfg.id, name: cfg.name, type: cfg.type, ok: false, note: e.message }); }
  }
  return out;
}

// ---------- auth ----------
const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const safeEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function authed(req) {
  if (isLocal(req)) return true;
  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
  const cookie = /(?:^|;\s*)atm=([^;]+)/.exec(req.headers.cookie || '')?.[1] || '';
  return [bearer, cookie].some((t) => t && safeEq(t, config.token));
}

// ---------- http ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const body = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch (e) { reject(e); } });
});

const clients = new Set();
const gpus = () => running.filter((r) => r.cfg.type === 'gpu').map((r) => r.inst);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  try {
    if (p === '/api/login' && req.method === 'POST') {
      const { token } = await body(req);
      if (!token || !safeEq(String(token), config.token)) return send(res, 401, { error: 'Wrong token' });
      res.setHeader('Set-Cookie', `atm=${config.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
      return send(res, 200, { ok: true });
    }
    if (p.startsWith('/api/')) {
      if (!authed(req)) return send(res, 401, { error: 'Login required' });

      if (p === '/api/data') return send(res, 200, data());
      if (p === '/api/live') return send(res, 200, await live());
      if (p === '/api/rates') return send(res, 200, getRates());
      if (p === '/api/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
        const c = { res, version: -1 };
        clients.add(c);
        gpus().forEach((g) => g.watch?.(true));
        req.on('close', () => { clients.delete(c); gpus().forEach((g) => g.watch?.(false)); });
        return;
      }
      if (p === '/api/config' && req.method === 'GET') {
        return send(res, 200, {
          lan: LAN, port: PORT, local: isLocal(req),
          token: isLocal(req) ? config.token : undefined, // shown only on this PC, for pairing a phone
          sources: config.sources.map(publicSource),
          types: Object.values(TYPES).map((m) => m.info),
          alerts: config.alerts.map(publicAlert),
          periods: PERIODS,
          webhookFormats: WEBHOOK_FORMATS,
          cloud: isLocal(req) ? publicCloud() : undefined,
        });
      }
      // The cloud mirror holds a push token, so only this PC can change or test it.
      if (p.startsWith('/api/cloud')) {
        if (!isLocal(req)) return send(res, 403, { error: 'Change the cloud mirror on the PC running the monitor' });
        if (p === '/api/cloud' && req.method === 'PUT') {
          const b = await body(req), c = config.cloud;
          if (b.url != null) {
            const u = String(b.url).trim().replace(/\/+$/, '');
            if (u && !/^https:\/\//.test(u)) return send(res, 400, { error: 'The site address must start with https://' });
            c.url = u;
          }
          if (b.pushToken != null && b.pushToken !== '••••••') c.pushToken = String(b.pushToken).trim();
          for (const k of ['enabled', 'includeTitles']) if (b[k] != null) c[k] = b[k] === true || b[k] === 'on' || b[k] === 'true';
          await saveConfig();
          if (c.enabled) await cloud.push(true);
          return send(res, 200, publicCloud());
        }
        if (p === '/api/cloud/test' && req.method === 'POST') return send(res, 200, await cloud.push(true));
      }
      if (p === '/api/alerts' && req.method === 'POST') {
        const a = alertFrom({ name: 'Budget', period: 'day', metric: 'cost', limit: 10, warnAt: 80, browser: false, app: '', model: '', ...(await body(req)) }, { id: randomUUID(), enabled: true });
        config.alerts.push(a);
        await saveConfig();
        return send(res, 200, publicAlert(a));
      }
      const am = p.match(/^\/api\/alerts\/([\w-]+)(\/test)?$/);
      if (am) {
        const i = config.alerts.findIndex((a) => a.id === am[1]);
        if (i < 0) return send(res, 404, { error: 'Not found' });
        const a = config.alerts[i];
        if (am[2]) {
          const st = evaluate(a, data().daily, data().sessions);
          return send(res, 200, a.webhook ? await sendWebhook(a, `Test alert from AI Token Monitor. ${message(a, { ...st, level: 'test' })}`) : { ok: true, note: 'No webhook set; browser alerts show on the dashboard.' });
        }
        if (req.method === 'DELETE') { config.alerts.splice(i, 1); await saveConfig(); return send(res, 200, { ok: true }); }
        if (req.method === 'PUT') { config.alerts[i] = alertFrom(await body(req), a); await saveConfig(); return send(res, 200, publicAlert(config.alerts[i])); }
      }
      if (p === '/api/sources' && req.method === 'POST') {
        const b = await body(req);
        if (!TYPES[b.type]) return send(res, 400, { error: 'Unknown type' });
        const src = { id: randomUUID(), type: b.type, name: String(b.name || TYPES[b.type].info.label).slice(0, 60), enabled: true };
        for (const f of TYPES[b.type].info.fields) if (b[f.key] != null && b[f.key] !== '') src[f.key] = String(b[f.key]);
        config.sources.push(src);
        await saveConfig(); await boot();
        return send(res, 200, publicSource(src));
      }
      const m = p.match(/^\/api\/sources\/([\w-]+)(\/test)?$/);
      if (m) {
        const src = config.sources.find((s) => s.id === m[1]);
        if (!src) return send(res, 404, { error: 'Not found' });
        if (m[2]) {
          const inst = (TYPES[src.type].create).call(TYPES[src.type], src, createStore());
          await inst.start?.(); const st = await inst.status?.(); inst.stop?.();
          return send(res, 200, st || { ok: true, note: 'Loaded' });
        }
        if (req.method === 'DELETE') {
          config.sources = config.sources.filter((s) => s !== src);
          await saveConfig(); await boot();
          return send(res, 200, { ok: true });
        }
        if (req.method === 'PUT') {
          const b = await body(req);
          if (typeof b.enabled === 'boolean') src.enabled = b.enabled;
          if (b.name) src.name = String(b.name).slice(0, 60);
          for (const f of TYPES[src.type].info.fields) {
            if (b[f.key] == null || (f.secret && b[f.key] === '••••••')) continue;
            if (b[f.key] === '') delete src[f.key]; else src[f.key] = String(b[f.key]);
          }
          await saveConfig(); await boot();
          return send(res, 200, publicSource(src));
        }
      }
      return send(res, 404, { error: 'Not found' });
    }

    // static files
    const file = join(PUBLIC, p === '/' ? 'index.html' : p);
    if (!file.startsWith(PUBLIC)) return send(res, 403, 'Forbidden', 'text/plain');
    const buf = await readFile(file).catch(() => null);
    if (!buf) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(buf);
  } catch (e) {
    send(res, 500, { error: e.message });
  }
});

// Push updates to open dashboards: usage when it changes, live status every 3 s.
setInterval(async () => {
  if (!clients.size) return;
  const lv = await live();
  const snap = clients.size && [...clients].some((c) => c.version !== store.version) ? data() : null;
  for (const c of clients) {
    if (snap && c.version !== store.version) { c.res.write(`event: data\ndata: ${JSON.stringify(snap)}\n\n`); c.version = store.version; }
    c.res.write(`event: live\ndata: ${JSON.stringify(lv)}\n\n`);
  }
}, 3000);

await loadPrices(DATA);
await loadRates(DATA);
setInterval(() => loadRates(DATA), 6 * 3600e3);
await boot();
server.listen(PORT, LAN ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`[monitor] http://127.0.0.1:${PORT}${LAN ? '  (LAN on: other devices need the access token from Settings)' : ''}`);
});
