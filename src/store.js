// In-memory usage store. Collectors push normalised records; the server reads aggregates.
// A record: { ts, app, model, session, in, out, cacheRead, cacheWrite, reasoning, cost }
// cost is USD (API-equivalent estimate unless the tool reports its own cost).

export const dayKey = (ts) => new Date(ts).toLocaleDateString('en-CA'); // YYYY-MM-DD, local time

export function createStore() {
  const daily = new Map();    // `${day}|${app}|${model}` -> totals
  const hourly = new Map();   // `${hourStartMs}|${app}` -> totals (last 48 h)
  const sessions = new Map(); // `${app}:${id}` -> session totals + meta
  const recent = [];          // newest last, capped
  const limits = {};          // app -> { primary, secondary, updated }
  let version = 0;

  const blank = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, calls: 0, unpriced: 0 });
  const add = (t, r) => {
    t.in += r.in; t.out += r.out; t.cacheRead += r.cacheRead; t.cacheWrite += r.cacheWrite;
    t.reasoning += r.reasoning; t.calls += 1;
    if (r.cost == null) t.unpriced += 1; else t.cost += r.cost;
  };

  function push(r) {
    const day = dayKey(r.ts);
    const dk = `${day}|${r.app}|${r.model}`;
    if (!daily.has(dk)) daily.set(dk, { day, app: r.app, model: r.model, ...blank() });
    add(daily.get(dk), r);

    if (r.ts > Date.now() - 48 * 3600e3) {
      const h = Math.floor(r.ts / 3600e3) * 3600e3;
      const hk = `${h}|${r.app}`;
      if (!hourly.has(hk)) hourly.set(hk, { hour: h, app: r.app, ...blank() });
      add(hourly.get(hk), r);
    }

    const sk = `${r.app}:${r.session}`;
    let s = sessions.get(sk);
    if (!s) {
      s = { key: sk, app: r.app, id: r.session, title: '', project: '', models: {}, first: r.ts, last: r.ts, ...blank() };
      sessions.set(sk, s);
    }
    add(s, r);
    s.first = Math.min(s.first, r.ts);
    s.last = Math.max(s.last, r.ts);
    s.models[r.model] = (s.models[r.model] || 0) + r.in + r.out + r.cacheRead + r.cacheWrite;

    recent.push(r);
    if (recent.length > 400) recent.splice(0, recent.length - 300);
    version++;
  }

  function meta(app, id, fields) {
    const sk = `${app}:${id}`;
    let s = sessions.get(sk);
    if (!s) {
      s = { key: sk, app, id, title: '', project: '', models: {}, first: Infinity, last: 0, ...blank() };
      sessions.set(sk, s);
    }
    for (const [k, v] of Object.entries(fields)) if (v) s[k] = v;
    version++;
  }

  function setLimits(app, value) { limits[app] = { ...value, updated: Date.now() }; version++; }

  function snapshot() {
    const cutoff = Date.now() - 48 * 3600e3;
    for (const [k, v] of hourly) if (v.hour < cutoff) hourly.delete(k);
    return {
      version,
      generatedAt: Date.now(),
      daily: [...daily.values()],
      hourly: [...hourly.values()],
      sessions: [...sessions.values()].filter((s) => s.calls > 0)
        .map(({ models, ...s }) => ({ ...s, model: topKey(models) })),
      recent: recent.slice(-60).reverse(),
      limits,
    };
  }

  return { push, meta, setLimits, snapshot, get version() { return version; } };
}

const topKey = (o) => Object.entries(o).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
