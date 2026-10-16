// Netlify Function for the cloud mirror. Your PC pushes a trimmed snapshot here; your phone reads it.
// Budget edits made on the phone are queued as operations; the PC pulls and applies them within seconds,
// then pushes the result back, so the PC stays the single source of truth.
// Env vars (set on the Netlify site): ATM_PUSH_TOKEN (used by the PC), ATM_VIEW_TOKEN (typed on the phone).
import { getStore } from '@netlify/blobs';
import { timingSafeEqual, randomUUID } from 'node:crypto';

const json = (code, body, headers = {}) => new Response(JSON.stringify(body), {
  status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const same = (a, b) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer /, '');
const cookie = (req) => /(?:^|;\s*)atm=([^;]+)/.exec(req.headers.get('cookie') || '')?.[1] || '';

// Only these budget fields can be changed from the phone; webhooks stay on the PC.
const PERIODS = ['day', 'week', 'month'];
function cleanFields(b = {}) {
  const f = {};
  if (b.name != null) f.name = String(b.name).slice(0, 60);
  for (const k of ['app', 'model']) if (b[k] != null) f[k] = String(b[k]).slice(0, 120);
  if (PERIODS.includes(b.period)) f.period = b.period;
  if (['cost', 'tokens'].includes(b.metric)) f.metric = b.metric;
  if (b.limit != null && Number.isFinite(Number(b.limit))) f.limit = Math.max(0, Number(b.limit));
  if (b.warnAt != null && Number.isFinite(Number(b.warnAt))) f.warnAt = Math.min(100, Math.max(1, Number(b.warnAt)));
  for (const k of ['browser', 'enabled', 'perSession']) if (typeof b[k] === 'boolean') f[k] = b[k];
  return f;
}

export default async (req) => {
  const PUSH = process.env.ATM_PUSH_TOKEN || '', VIEW = process.env.ATM_VIEW_TOKEN || '';
  if (!PUSH || !VIEW) return json(503, { error: 'Cloud mirror is not configured on this site' });
  const url = new URL(req.url), path = url.pathname;
  const store = getStore({ name: 'ai-token-monitor', consistency: 'strong' }); // read-after-write, so edits show at once

  // ----- PC side (push token) -----
  if (path === '/api/push' && req.method === 'POST') {
    if (!same(bearer(req), PUSH)) return json(401, { error: 'Wrong push token' });
    const text = await req.text();
    if (text.length > 8 * 1024 * 1024) return json(413, { error: 'Snapshot too large' });
    await store.set('latest', text);
    return json(200, { ok: true });
  }
  if (path === '/api/ops' && req.method === 'GET') {
    if (!same(bearer(req), PUSH)) return json(401, { error: 'Wrong push token' });
    const after = Number(url.searchParams.get('after')) || 0;
    const q = (await store.get('ops', { type: 'json' })) || { seq: 0, ops: [] };
    return json(200, { seq: q.seq, ops: q.ops.filter((o) => o.seq > after) });
  }

  // ----- phone side (view token) -----
  if (path === '/api/login' && req.method === 'POST') {
    const { token } = await req.json().catch(() => ({}));
    if (!same(String(token || ''), VIEW)) return json(401, { error: 'Wrong token' });
    return json(200, { ok: true }, { 'Set-Cookie': `atm=${VIEW}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
  }
  if (!same(bearer(req), VIEW) && !same(cookie(req), VIEW)) return json(401, { error: 'Login required' });

  const am = path.match(/^\/api\/alerts(?:\/([\w-]+))?(\/test)?$/);
  if (am) {
    if (am[2]) return json(200, { ok: true, note: 'Webhook tests run from Settings on your PC.' });
    let op;
    if (!am[1] && req.method === 'POST') op = { op: 'add', id: randomUUID(), fields: cleanFields(await req.json().catch(() => ({}))) };
    else if (am[1] && req.method === 'PUT') op = { op: 'update', id: am[1], fields: cleanFields(await req.json().catch(() => ({}))) };
    else if (am[1] && req.method === 'DELETE') op = { op: 'delete', id: am[1] };
    else return json(405, { error: 'Method not allowed' });
    if (op.op === 'add' && !(op.fields.limit > 0)) return json(400, { error: 'Enter a budget above zero' });

    const q = (await store.get('ops', { type: 'json' })) || { seq: 0, ops: [] };
    op.seq = ++q.seq; op.at = Date.now();
    q.ops = [...q.ops, op].filter((o) => o.at > Date.now() - 864e5).slice(-200);
    await store.setJSON('ops', q);

    // Show the change on the phone straight away; the PC's next push replaces this with the real result.
    const latest = await store.get('latest', { type: 'json' });
    if (latest) {
      const list = latest.alerts || [];
      if (op.op === 'add') list.push({ id: op.id, enabled: true, browser: false, warnAt: 80, app: '', model: '', period: 'day', metric: 'cost', name: 'Budget', ...op.fields, pending: true });
      else {
        const i = list.findIndex((a) => a.id === op.id);
        if (i >= 0 && op.op === 'delete') list.splice(i, 1);
        if (i >= 0 && op.op === 'update') list[i] = { ...list[i], ...op.fields, pending: true };
      }
      latest.alerts = list;
      await store.setJSON('latest', latest);
    }
    return json(200, { ok: true, id: op.id });
  }

  const latest = await store.get('latest', { type: 'json' });
  if (path === '/api/config') {
    return json(200, { cloud: true, pushedAt: latest?.at || 0, alerts: latest?.alerts || [], ...(latest?.meta || {}) });
  }
  if (!latest) return json(404, { error: 'No data pushed yet. Turn on the cloud mirror in Settings on your PC.' });
  if (path === '/api/data') return json(200, { ...latest.data, pushedAt: latest.at });
  if (path === '/api/live') return json(200, latest.live || []);
  if (path === '/api/rates') return json(200, latest.rates || { rates: { USD: 1 } });
  return json(404, { error: 'Not found' });
};

export const config = { path: '/api/*' };
