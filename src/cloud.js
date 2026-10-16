// Cloud mirror: pushes a trimmed copy of the dashboard to your own Netlify site (see cloud/README.md),
// so you can check usage from a phone anywhere. Off unless you set it up in Settings.
// Session titles and project folders are removed unless you opt in, because they often name clients.

const SESSION_DAYS = 30;
const MAX_SESSIONS = 400;

export function sanitize(snap, includeTitles) {
  const since = Date.now() - SESSION_DAYS * 864e5;
  const sessions = snap.sessions
    .filter((s) => s.last >= since)
    .sort((a, b) => b.last - a.last)
    .slice(0, MAX_SESSIONS)
    .map((s) => (includeTitles ? s : { ...s, title: `Session ${String(s.id).slice(0, 6)}`, project: '' }));
  return { ...snap, sessions };
}

export function createCloudPusher({ getConfig, getData, getLive, getRates }) {
  let lastVersion = -1, lastPush = 0, lastResult = { ok: null, note: 'Not pushed yet' };

  async function push(force = false) {
    const c = getConfig();
    if (!c?.enabled || !c.url || !c.pushToken) return lastResult;
    const snap = getData();
    // Push when usage changed, and at least every 5 minutes so the cloud page shows the monitor is alive.
    if (!force && snap.version === lastVersion && Date.now() - lastPush < 5 * 60e3) return lastResult;
    try {
      const body = JSON.stringify({ data: sanitize(snap, c.includeTitles), live: await getLive(), rates: getRates(), at: Date.now() });
      const res = await fetch(new URL('/api/push', c.url), {
        method: 'POST', body, signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.pushToken}` },
      });
      lastResult = res.ok ? { ok: true, note: `Pushed ${(body.length / 1024).toFixed(0)} KB at ${new Date().toLocaleTimeString()}` } : { ok: false, note: `HTTP ${res.status}` };
      if (res.ok) { lastVersion = snap.version; lastPush = Date.now(); }
    } catch (e) { lastResult = { ok: false, note: e.message }; }
    return lastResult;
  }
  return { push, status: () => lastResult };
}
