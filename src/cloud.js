// Cloud mirror: pushes a trimmed copy of the dashboard to your own Netlify site (see cloud/README.md),
// so you can check usage from a phone anywhere. Off unless you set it up in Settings.
// Session titles and project folders are removed unless you opt in, because they often name clients.
// Budget edits made on the phone come back as queued operations, pulled every few seconds.

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

// Budgets as the phone may see them: no webhook URLs.
const phoneAlert = ({ webhook, webhookFormat, ...a }) => ({ ...a, hasWebhook: !!webhook });

export function createCloudPusher({ getConfig, getData, getLive, getRates, getAlerts, getMeta, applyOps }) {
  let lastVersion = -1, lastAlerts = '', lastPush = 0, busy = false, lastResult = { ok: null, note: 'Not pushed yet' };
  const api = (c, path, init = {}) => fetch(new URL(path, c.url), {
    signal: AbortSignal.timeout(15000), ...init,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.pushToken}`, ...init.headers },
  });

  async function push(force = false) {
    const c = getConfig();
    if (!c?.enabled || !c.url || !c.pushToken || busy) return lastResult;
    const snap = getData();
    const alerts = getAlerts().map(phoneAlert), alertsKey = JSON.stringify(alerts);
    // Push when usage or budgets changed, and at least every 5 minutes so the cloud page shows the monitor is alive.
    if (!force && snap.version === lastVersion && alertsKey === lastAlerts && Date.now() - lastPush < 5 * 60e3) return lastResult;
    busy = true;
    try {
      const body = JSON.stringify({ data: sanitize(snap, c.includeTitles), alerts, meta: getMeta(), live: await getLive(), rates: getRates(), at: Date.now() });
      const res = await api(c, '/api/push', { method: 'POST', body });
      lastResult = res.ok ? { ok: true, note: `Pushed ${(body.length / 1024).toFixed(0)} KB at ${new Date().toLocaleTimeString()}` } : { ok: false, note: `HTTP ${res.status}` };
      if (res.ok) { lastVersion = snap.version; lastAlerts = alertsKey; lastPush = Date.now(); }
    } catch (e) { lastResult = { ok: false, note: e.message }; }
    finally { busy = false; }
    return lastResult;
  }

  // Pull budget changes made on the phone, apply them, then push the result back at once.
  async function pull() {
    const c = getConfig();
    if (!c?.enabled || !c.url || !c.pushToken) return;
    try {
      const res = await api(c, `/api/ops?after=${c.opsSeq || 0}`);
      if (!res.ok) return;
      const { seq, ops } = await res.json();
      if (!ops.length && seq === (c.opsSeq || 0)) return;
      await applyOps(ops, seq); // also stores seq, so each operation is applied once
      if (ops.length) await push(true);
    } catch { /* offline: try again next tick */ }
  }
  return { push, pull, status: () => lastResult };
}
