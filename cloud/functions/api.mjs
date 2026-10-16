// Netlify Function for the cloud mirror. Your PC pushes a trimmed snapshot here; your phone reads it.
// Env vars (set on the Netlify site): ATM_PUSH_TOKEN (used by the PC), ATM_VIEW_TOKEN (typed on the phone).
import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';

const json = (code, body, headers = {}) => new Response(JSON.stringify(body), {
  status: code, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
});
const same = (a, b) => !!a && !!b && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const bearer = (req) => (req.headers.get('authorization') || '').replace(/^Bearer /, '');
const cookie = (req) => /(?:^|;\s*)atm=([^;]+)/.exec(req.headers.get('cookie') || '')?.[1] || '';

export default async (req) => {
  const { PUSH = '', VIEW = '' } = { PUSH: process.env.ATM_PUSH_TOKEN, VIEW: process.env.ATM_VIEW_TOKEN };
  if (!PUSH || !VIEW) return json(503, { error: 'Cloud mirror is not configured on this site' });
  const path = new URL(req.url).pathname;
  const store = getStore('ai-token-monitor');

  if (path === '/api/push' && req.method === 'POST') {
    if (!same(bearer(req), PUSH)) return json(401, { error: 'Wrong push token' });
    const text = await req.text();
    if (text.length > 8 * 1024 * 1024) return json(413, { error: 'Snapshot too large' });
    await store.set('latest', text);
    return json(200, { ok: true });
  }
  if (path === '/api/login' && req.method === 'POST') {
    const { token } = await req.json().catch(() => ({}));
    if (!same(String(token || ''), VIEW)) return json(401, { error: 'Wrong token' });
    return json(200, { ok: true }, { 'Set-Cookie': `atm=${VIEW}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
  }

  if (!same(bearer(req), VIEW) && !same(cookie(req), VIEW)) return json(401, { error: 'Login required' });
  const latest = await store.get('latest', { type: 'json' });
  if (path === '/api/config') return json(200, { cloud: true, pushedAt: latest?.at || 0 });
  if (!latest) return json(404, { error: 'No data pushed yet. Turn on the cloud mirror in Settings on your PC.' });
  if (path === '/api/data') return json(200, { ...latest.data, pushedAt: latest.at });
  if (path === '/api/live') return json(200, latest.live || []);
  if (path === '/api/rates') return json(200, latest.rates || { rates: { USD: 1 } });
  return json(404, { error: 'Not found' });
};

export const config = { path: '/api/*' };
