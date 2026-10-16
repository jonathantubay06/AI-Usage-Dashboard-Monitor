// AI Token Monitor dashboard. Vanilla JS, no build step.
import { detectRegion, regionCurrency, regionName, currencyList, formatMoney } from './currency.js';
const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const state = { data: null, live: [], config: null, tab: 'overview', range: '7d', sort: { key: 'last', dir: -1 }, q: '', metric: 'cost', feedSeen: new Set() };
try { Object.assign(state, JSON.parse(localStorage.getItem('atm-ui') || '{}'), { data: null, live: [], config: null, feedSeen: new Set() }); } catch { /* private mode */ }
const saveUi = () => { try { localStorage.setItem('atm-ui', JSON.stringify({ tab: state.tab, range: state.range, metric: state.metric, currency: state.currency })); } catch { /* ignore */ } };

// ---------- formatting ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tok = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${Math.round(n)}`;
// Costs are stored in USD and converted for display only.
const home = { region: detectRegion() };
home.currency = regionCurrency(home.region);
const fx = { rates: { USD: 1 }, updated: 0 };
const cur = () => (fx.rates[state.currency] ? state.currency : 'USD');
const usd = (n) => formatMoney(n, cur(), fx.rates[cur()]);
if (!state.currency) state.currency = home.currency;

// ---------- currency picker ----------
function curRow(c, tag) {
  return `<li><button type="button" data-cur="${c.code}" aria-selected="${c.code === cur()}">
    <span class="cur-code">${c.code}</span><span class="cur-name"><span>${esc(c.name)}</span>${tag ? `<span><span class="chip">${tag}</span></span>` : ''}
    <span class="muted">${esc(c.countries.slice(0, 4).join(', '))}${c.countries.length > 4 ? ` +${c.countries.length - 4}` : ''}${c.code === 'USD' ? '' : ` · 1 USD = ${fx.rates[c.code].toLocaleString(undefined, { maximumFractionDigits: 4 })}`}</span></span></button></li>`;
}
function renderCurList() {
  const q = ($('#cur-q').value || '').trim().toLowerCase();
  const all = currencyList(fx.rates);
  const hit = (c) => !q || c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q) || c.countries.some((n) => n.toLowerCase().includes(q));
  const pinned = [home.currency, 'USD'].filter((code, i, a) => a.indexOf(code) === i).map((code) => all.find((c) => c.code === code)).filter(Boolean);
  const top = pinned.filter(hit).map((c) => curRow(c, c.code === home.currency ? `Where you are: ${esc(regionName(home.region))}` : 'Original prices'));
  const rest = all.filter((c) => !pinned.includes(c) && hit(c)).map((c) => curRow(c));
  $('#cur-list').innerHTML = [...top, top.length && rest.length ? '<li class="cur-sep" role="separator"></li>' : '', ...rest].join('') || '<li class="empty">No currency matches.</li>';
  $('#cur-note').textContent = fx.updated ? `Rates from open.er-api.com, updated ${new Date(fx.updated).toLocaleDateString()}. Costs are tracked in US dollars and converted for display.` : 'Exchange rates are not available right now, so costs show in US dollars.';
}
function openCurrency() {
  $('#cur-q').value = '';
  renderCurList();
  $('#cur-dlg').showModal();
  $('#cur-q').focus();
}
const curLabel = () => { $('#cur-btn').textContent = cur(); $('#cur-btn').title = `Costs shown in ${cur()}. Click to change.`; };
const total = (t) => t.in + t.out + t.cacheRead + t.cacheWrite;
const ago = (ts) => { const s = (Date.now() - ts) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`; };
const day = (d) => d.toLocaleDateString('en-CA');
const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const shortModel = (m) => String(m).replace(/^claude-/, '').replace(/-\d{8}$/, '');
const metricOf = (t) => state.metric === 'cost' ? t.cost : total(t);
const fmtMetric = (n) => state.metric === 'cost' ? usd(n) : tok(n);
const SERIES = ['--series-1', '--series-2', '--series-3', '--series-4', '--series-5', '--series-6'];
const colorMap = new Map();
const color = (name) => { if (!colorMap.has(name)) colorMap.set(name, `var(${SERIES[colorMap.size % SERIES.length]})`); return colorMap.get(name); };

function rangeStart(range = state.range) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (range === 'today') return day(d);
  if (range === '7d') { d.setDate(d.getDate() - 6); return day(d); }
  if (range === '30d') { d.setDate(d.getDate() - 29); return day(d); }
  return '0000';
}
const blank = () => ({ in: 0, out: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, cost: 0, calls: 0, unpriced: 0 });
function sum(rows) { const t = blank(); for (const r of rows) for (const k in t) t[k] += r[k] || 0; return t; }
function group(rows, keyFn) {
  const m = new Map();
  for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
const inRange = (from = rangeStart()) => state.data.daily.filter((d) => d.day >= from);

// ---------- charts ----------
function stackedBars(days, seriesNames, valueOf) {
  const W = 800, H = 220, pad = { l: 46, r: 8, t: 10, b: 26 };
  const max = Math.max(1e-9, ...days.map((d) => seriesNames.reduce((a, s) => a + valueOf(d, s), 0)));
  const bw = (W - pad.l - pad.r) / Math.max(1, days.length);
  const y = (v) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  let out = '';
  for (let i = 0; i <= 3; i++) {
    const v = (max * i) / 3, yy = y(v);
    out += `<line class="axis" x1="${pad.l}" x2="${W - pad.r}" y1="${yy}" y2="${yy}" stroke-dasharray="${i ? '2 4' : ''}"/><text x="${pad.l - 6}" y="${yy + 4}" text-anchor="end">${fmtMetric(v)}</text>`;
  }
  const every = Math.ceil(days.length / 10);
  days.forEach((d, i) => {
    let acc = 0;
    const x = pad.l + i * bw + bw * 0.15, w = Math.max(1, bw * 0.7);
    for (const s of seriesNames) {
      const v = valueOf(d, s);
      if (!v) continue;
      out += `<rect x="${x}" y="${y(acc + v)}" width="${w}" height="${Math.max(0.5, y(acc) - y(acc + v))}" rx="2" fill="${color(s)}"><title>${esc(d.label)} · ${esc(s)}: ${fmtMetric(v)}</title></rect>`;
      acc += v;
    }
    if (i % every === 0) out += `<text x="${x + w / 2}" y="${H - 8}" text-anchor="middle">${esc(d.short)}</text>`;
  });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Usage chart">${out}</svg>
    <div class="legend">${seriesNames.map((s) => `<span><i style="background:${color(s)}"></i>${esc(s)}</span>`).join('')}</div>`;
}
function dayList(from) {
  const start = from === '0000' ? new Date(Math.min(...state.data.daily.map((d) => Date.parse(d.day)))) : new Date(`${from}T00:00`);
  const out = [], d = new Date(start), end = new Date();
  if (state.range === 'all' && (end - d) / 864e5 > 120) d.setTime(end - 119 * 864e5); // keep "All" readable
  while (day(d) <= day(end)) { out.push({ key: day(d), label: d.toDateString(), short: d.toLocaleDateString([], { month: 'short', day: 'numeric' }) }); d.setDate(d.getDate() + 1); }
  return out;
}
const barList = (rows, max) => `<div class="bars">${rows.map((r) => `
  <div class="barrow"><span class="name">${esc(r.name)}</span><span class="num">${r.text}</span>
  <div class="track"><div class="fill" style="width:${max ? (100 * r.value) / max : 0}%;background:${r.color || 'var(--color-accent)'}"></div></div></div>`).join('')}</div>`;

// ---------- views ----------
function overview() {
  const rows = inRange();
  const t = sum(rows);
  const today = sum(inRange(rangeStart('today')));
  const lastHour = sum(state.data.hourly.filter((h) => h.hour >= Date.now() - 3600e3));
  const cacheShare = t.cacheRead / Math.max(1, t.in + t.cacheRead + t.cacheWrite);
  const activeSessions = state.data.sessions.filter((s) => s.last > Date.now() - 3600e3).length;
  const apps = [...group(rows, (r) => r.app)].map(([name, r]) => ({ name, t: sum(r) })).sort((a, b) => metricOf(b.t) - metricOf(a.t));
  const models = [...group(rows, (r) => r.model)].map(([name, r]) => ({ name, t: sum(r) })).sort((a, b) => metricOf(b.t) - metricOf(a.t)).slice(0, 8);
  const days = dayList(rangeStart());
  const byDayApp = group(rows, (r) => `${r.day}|${r.app}`);
  const dv = (d, s) => metricOf(sum(byDayApp.get(`${d.key}|${s}`) || []));
  const hours = [];
  for (let h = Math.floor(Date.now() / 3600e3) * 3600e3 - 23 * 3600e3; h <= Date.now(); h += 3600e3) {
    const dt = new Date(h); hours.push({ key: h, label: dt.toLocaleString(), short: dt.getHours().toString().padStart(2, '0') });
  }
  const byHour = group(state.data.hourly, (r) => `${r.hour}|${r.app}`);
  const hv = (d, s) => metricOf(sum(byHour.get(`${d.key}|${s}`) || []));

  return `${alertBanners()}
  <section class="kpis">
    ${kpi('Tokens', tok(total(t)), `${t.calls.toLocaleString()} calls`)}
    ${kpi('Est. cost', usd(t.cost), t.unpriced ? `${t.unpriced} calls unpriced` : 'API-equivalent')}
    ${kpi('Today', usd(today.cost), `${tok(total(today))} tokens`)}
    ${kpi('Last 60 min', usd(lastHour.cost), `${tok(total(lastHour))} tokens · burn ${usd(lastHour.cost)}/h`)}
    ${kpi('Cache reads', `${(cacheShare * 100).toFixed(1)}%`, 'of input served from cache')}
    ${kpi('Active sessions', activeSessions, 'used in the last hour')}
  </section>
  <section class="grid-2">
    <div class="card"><h2>Daily ${state.metric === 'cost' ? 'cost' : 'tokens'} by app <small>${metricToggle()}</small></h2>${stackedBars(days, apps.map((a) => a.name), dv)}</div>
    <div class="card"><h2>By app</h2>${barList(apps.map((a) => ({ name: a.name, value: metricOf(a.t), text: `${fmtMetric(metricOf(a.t))}`, color: color(a.name) })), metricOf(apps[0]?.t || blank()))}
      <h2 style="margin-top:var(--space-lg)">Top models</h2>${barList(models.map((m) => ({ name: shortModel(m.name), value: metricOf(m.t), text: fmtMetric(metricOf(m.t)) })), metricOf(models[0]?.t || blank()))}</div>
  </section>
  <section class="grid-2">
    <div class="card"><h2>Last 24 hours</h2>${stackedBars(hours, apps.map((a) => a.name), hv)}</div>
    <div class="card"><h2>Budgets</h2>${budgetsHtml()}<h2 style="margin-top:var(--space-lg)">Plan limits</h2>${limitsHtml()}</div>
  </section>
  <section class="card"><h2>Live feed <small>every call as it lands</small></h2>${feedHtml()}</section>`;
}
// ---------- budget alerts ----------
const PERIOD_LABEL = { day: 'today', week: 'this week', month: 'this month' };
const amount = (a, v) => (a.metric === 'tokens' ? tok(v) : usd(v));
const scopeOf = (a) => [a.app, a.model && shortModel(a.model)].filter(Boolean).join(' · ') || 'All tools';
function alertBanners() {
  const hot = (state.data.alerts || []).filter((a) => a.level !== 'ok');
  return hot.length ? `<section class="alerts" role="status">${hot.map((a) => `<div class="alert ${a.level}">
    <strong>${a.level === 'over' ? 'Over budget' : 'Budget warning'}:</strong> ${esc(a.name)} is at ${amount(a, a.used)} of ${amount(a, a.limit)} (${Math.round(a.pct)}%) ${PERIOD_LABEL[a.period]}.</div>`).join('')}</section>` : '';
}
function budgetsHtml() {
  const list = state.data.alerts || [];
  if (!list.length) return `<p class="note">No budgets yet. <button class="btn" data-goto="settings" style="padding:2px 10px">Add one in Settings</button></p>`;
  return list.map((a) => `<div style="margin-bottom:var(--space-sm)"><div class="barrow"><span class="name">${esc(a.name)} <span class="muted">· ${esc(scopeOf(a))} · ${PERIOD_LABEL[a.period]}</span></span>
    <span class="num">${amount(a, a.used)} / ${amount(a, a.limit)}</span></div>
    <div class="meter ${a.level !== 'ok' ? 'hot' : ''}"><div style="transform:scaleX(${Math.min(1, a.pct / 100)})"></div></div></div>`).join('');
}
// Browser notification once per rule, period and level while a dashboard is open.
function notifyAlerts() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  for (const a of state.data.alerts || []) {
    if (a.level === 'ok' || !a.browser) continue;
    const key = `atm-n|${a.id}|${a.from}|${a.level}`;
    try { if (localStorage.getItem(key)) continue; localStorage.setItem(key, '1'); } catch { /* ignore */ }
    new Notification(a.level === 'over' ? 'Over budget' : 'Budget warning', { body: `${a.name}: ${amount(a, a.used)} of ${amount(a, a.limit)} ${PERIOD_LABEL[a.period]}`, icon: '/icon.svg' });
  }
}

const kpi = (label, value, sub) => `<div class="card kpi"><div class="label">${label}</div><div class="value num">${value}</div><div class="sub">${sub}</div></div>`;
const metricToggle = () => `<button class="btn" data-metric style="padding:2px 10px;font-size:12px">Show ${state.metric === 'cost' ? 'tokens' : 'cost'}</button>`;

function limitsHtml() {
  const entries = Object.entries(state.data.limits || {});
  const meter = (label, l) => l ? `<div><div class="barrow"><span>${label}</span><span class="num">${l.percent}%</span></div>
    <div class="meter ${l.percent >= 80 ? 'hot' : ''}"><div style="transform:scaleX(${Math.min(1, l.percent / 100)})"></div></div>
    <div class="note">resets ${new Date(l.resetsAt).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</div></div>` : '';
  const winName = (m) => m >= 10000 ? 'Weekly' : m >= 300 ? '5-hour' : `${m} min`;
  return (entries.map(([app, l]) => `<div style="display:grid;gap:var(--space-sm);margin-bottom:var(--space-md)"><strong>${esc(app)}</strong>
      ${meter(winName(l.primary?.windowMinutes), l.primary)}${meter(winName(l.secondary?.windowMinutes), l.secondary)}
      <div class="note">updated ${ago(l.updated)}</div></div>`).join('') || '<p class="note">No limit data yet.</p>')
    + '<p class="note">Claude plan limits are not written to local logs; check them in the Claude app (Settings, Usage).</p>';
}

function feedHtml() {
  const rows = state.data.recent.slice(0, 40);
  if (!rows.length) return '<p class="empty">No calls yet.</p>';
  const html = rows.map((r) => {
    const k = `${r.ts}|${r.session}|${r.out}`;
    const isNew = state.feedSeen.size && !state.feedSeen.has(k);
    return `<div class="${isNew ? 'new' : ''}"><span class="num muted">${time(r.ts)}</span>
      <span class="name"><span class="chip">${esc(r.app)}</span> ${esc(shortModel(r.model))}</span>
      <span class="num">${tok(total(r))} · ${r.cost == null ? '—' : usd(r.cost)}</span></div>`;
  }).join('');
  state.feedSeen = new Set(rows.map((r) => `${r.ts}|${r.session}|${r.out}`));
  return `<div class="feed">${html}</div>`;
}

function appsView() {
  const appNames = [...new Set(state.data.daily.map((d) => d.app))];
  const windows = [['Today', rangeStart('today')], ['7 days', rangeStart('7d')], ['30 days', rangeStart('30d')], ['All time', '0000']];
  return `<section class="grid-3">${appNames.map((app) => {
    const rows = state.data.daily.filter((d) => d.app === app);
    const sess = state.data.sessions.filter((s) => s.app === app);
    const models = [...group(rows.filter((r) => r.day >= rangeStart()), (r) => r.model)].map(([n, r]) => ({ n, t: sum(r) })).sort((a, b) => b.t.cost - a.t.cost || total(b.t) - total(a.t)).slice(0, 4);
    return `<div class="card"><h2><i class="chip" style="background:${color(app)};color:var(--color-paper);border:0">&nbsp;</i> ${esc(app)}</h2>
      <table><thead><tr><th></th><th class="r">Tokens</th><th class="r">Cost</th><th class="r">Calls</th></tr></thead><tbody>
      ${windows.map(([label, from]) => { const t = sum(rows.filter((r) => r.day >= from)); return `<tr><td>${label}</td><td class="r num">${tok(total(t))}</td><td class="r num">${usd(t.cost)}</td><td class="r num">${t.calls.toLocaleString()}</td></tr>`; }).join('')}
      </tbody></table>
      <p class="note">${sess.length} sessions · last used ${sess.length ? ago(Math.max(...sess.map((s) => s.last))) : 'never'}</p>
      ${models.length ? `<p class="note">Top models (${state.range}): ${models.map((m) => `${esc(shortModel(m.n))} ${usd(m.t.cost)}`).join(' · ')}</p>` : ''}
    </div>`;
  }).join('') || '<p class="empty">No apps connected. Add one in Settings.</p>'}</section>`;
}

function modelsView() {
  const t0 = rangeStart('today'), t7 = rangeStart('7d'), t30 = rangeStart('30d');
  const rows = [...group(state.data.daily, (r) => `${r.app}|${r.model}`)].map(([k, r]) => {
    const [app, model] = k.split('|');
    const all = sum(r), range = sum(r.filter((x) => x.day >= rangeStart()));
    return { app, model, range, today: sum(r.filter((x) => x.day >= t0)), d7: sum(r.filter((x) => x.day >= t7)), d30: sum(r.filter((x) => x.day >= t30)), all };
  }).filter((r) => r.range.calls).sort((a, b) => b.range.cost - a.range.cost || total(b.range) - total(a.range));
  return `<section class="card"><h2>Models <small>${state.range} · today / 7 d / 30 d cost alongside</small></h2><div class="table-wrap"><table>
    <thead><tr><th>Model</th><th>App</th><th class="r">Calls</th><th class="r">Input</th><th class="r">Output</th><th class="r hide-sm">Cache read</th><th class="r hide-sm">Cache write</th><th class="r">Cost</th><th class="r hide-sm">Today</th><th class="r hide-sm">7 d</th><th class="r hide-sm">30 d</th><th class="r hide-sm">$/call</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td>${esc(shortModel(r.model))}</td><td><span class="chip">${esc(r.app)}</span></td>
      <td class="r num">${r.range.calls.toLocaleString()}</td><td class="r num">${tok(r.range.in)}</td><td class="r num">${tok(r.range.out)}</td>
      <td class="r num hide-sm">${tok(r.range.cacheRead)}</td><td class="r num hide-sm">${tok(r.range.cacheWrite)}</td>
      <td class="r num">${r.range.unpriced === r.range.calls ? '—' : usd(r.range.cost)}</td>
      <td class="r num hide-sm">${usd(r.today.cost)}</td><td class="r num hide-sm">${usd(r.d7.cost)}</td><td class="r num hide-sm">${usd(r.d30.cost)}</td>
      <td class="r num hide-sm">${usd(r.range.cost / Math.max(1, r.range.calls))}</td></tr>`).join('') || '<tr><td colspan="12" class="empty">No usage in this range.</td></tr>'}</tbody></table></div></section>`;
}

function sessionsView() {
  const from = rangeStart();
  const fromTs = from === '0000' ? 0 : Date.parse(`${from}T00:00`);
  const q = state.q.toLowerCase();
  const rows = state.data.sessions.filter((s) => s.last >= fromTs && (!q || `${s.title} ${s.project} ${s.app} ${s.model}`.toLowerCase().includes(q)));
  const { key, dir } = state.sort;
  const val = (s) => key === 'tokens' ? total(s) : key === 'title' ? (s.title || s.project || '').toLowerCase() : s[key];
  rows.sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * dir);
  const th = (k, label, cls = '') => `<th data-sort="${k}" class="${cls}" aria-sort="${key === k ? (dir > 0 ? 'ascending' : 'descending') : 'none'}">${label}${key === k ? (dir > 0 ? ' ↑' : ' ↓') : ''}</th>`;
  const name = (s) => s.title || (s.project ? s.project.split(/[\\/]/).slice(-2).join('/') : s.id.slice(0, 8));
  return `<section class="card"><div class="toolbar"><input type="search" id="q" placeholder="Search title, folder, app, model" value="${esc(state.q)}" aria-label="Search sessions">
    <span class="note">${rows.length} sessions · ${usd(rows.reduce((a, s) => a + s.cost, 0))}</span></div>
    <div class="table-wrap"><table><thead><tr>${th('title', 'Session')}${th('app', 'App')}<th class="hide-sm">Model</th>${th('calls', 'Calls', 'r')}${th('tokens', 'Tokens', 'r')}${th('cost', 'Cost', 'r')}${th('last', 'Last active', 'r')}</tr></thead>
    <tbody>${rows.slice(0, 300).map((s) => `<tr><td class="title" title="${esc(s.project)}">${esc(name(s))}</td><td><span class="chip">${esc(s.app)}</span></td>
      <td class="hide-sm">${esc(shortModel(s.model))}</td><td class="r num">${s.calls.toLocaleString()}</td><td class="r num">${tok(total(s))}</td>
      <td class="r num">${s.unpriced === s.calls ? '—' : usd(s.cost)}</td><td class="r num">${ago(s.last)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">No sessions match.</td></tr>'}</tbody></table></div>
    ${rows.length > 300 ? '<p class="note">Showing the first 300. Narrow the search or range to see more.</p>' : ''}</section>`;
}

function liveView() {
  const g = state.live.find((l) => l.type === 'gpu' && l.ok)?.gpu;
  const others = state.live.filter((l) => l.type !== 'gpu');
  return `<section class="grid-2">
    <div class="card"><h2>GPU</h2>${g ? `<div class="gauge"><div class="ring" style="--p:${g.util}"><div class="num">${Math.round(g.util)}%</div></div>
      <div class="kpis" style="flex:1;grid-template-columns:repeat(auto-fit,minmax(120px,1fr))">
        ${kpi('VRAM used', `${g.vramGB} GB`, g.vramTotalGB ? `of ${g.vramTotalGB} GB` : 'dedicated')}
        ${g.tempC != null ? kpi('Temperature', `${g.tempC} °C`, '') : ''}${g.powerW != null ? kpi('Power', `${g.powerW} W`, '') : ''}
      </div></div>` : `<p class="note">${esc(state.live.find((l) => l.type === 'gpu')?.note || 'GPU source is off. Turn it on in Settings.')}</p>`}</div>
    <div class="card"><h2>Plan limits</h2>${limitsHtml()}</div>
  </section>
  <section class="grid-3">${others.map((l) => `<div class="card"><h2>${esc(l.name)} <small>${esc(l.type)}</small></h2>
    <span class="status ${l.ok ? 'ok' : 'off'}">${esc(l.note || (l.ok ? 'Up' : 'Down'))}</span>
    ${(l.models || []).map((m) => `<div class="barrow" style="margin-top:var(--space-xs)"><span class="name">${esc(m.name)}</span><span class="num muted">${m.vramGB != null ? `${m.vramGB} GB` : ''}</span></div>`).join('')}
    ${l.rates ? `<div class="kpis" style="margin-top:var(--space-sm);grid-template-columns:repeat(2,minmax(0,1fr))">
      ${l.rates.decode != null ? kpi('Decode', `${l.rates.decode.toFixed(1)}`, 'tok/s') : ''}${l.rates.prefill != null ? kpi('Prefill', `${l.rates.prefill.toFixed(0)}`, 'tok/s') : ''}
      ${l.rates.running != null ? kpi('Running', l.rates.running, `${l.rates.queued ?? 0} queued`) : ''}${l.rates.kv != null ? kpi('KV cache', `${(l.rates.kv * 100).toFixed(1)}%`, '') : ''}</div>` : ''}
  </div>`).join('') || '<p class="empty">No live sources. Add Ollama, LM Studio or a server in Settings.</p>'}</section>`;
}

function settingsView() {
  const c = state.config;
  if (!c) return '<p class="empty">Loading…</p>';
  if (c.cloud === true) return `<section class="card"><h2>Cloud copy</h2>
    <p class="note">This is a read-only copy of your monitor, pushed from your computer${c.pushedAt ? `, last updated ${ago(c.pushedAt)}` : ''}. Sources, budgets and currency rates are managed in Settings on that computer. Session titles and project folders are hidden unless you allowed them there.</p></section>`;
  const typeOf = (t) => c.types.find((x) => x.type === t);
  const apps = [...new Set((state.data?.daily || []).map((d) => d.app))].sort();
  const models = [...new Set((state.data?.daily || []).map((d) => d.model))].sort();
  return `${DEMO ? '<section class="alert warn" role="note"><strong>Demo:</strong> this page shows invented data. Changes here are not saved.</section>' : ''}
  <section class="card"><h2>Getting started</h2>
    <ol class="steps">
      <li><strong>Check your sources.</strong> On first start the monitor adds every AI tool it finds on this computer. Each one below has a switch, a <em>Test</em> button and a <em>How to set up</em> guide.</li>
      <li><strong>Add anything missing.</strong> Use <em>Add a source</em> for LM Studio, a llama.cpp or vLLM server, Ollama on another machine, or another copy of this monitor on a VPS.</li>
      <li><strong>Set a budget.</strong> Add a rule under <em>Budget alerts</em> (for example "Claude Code, $50 a day") to get a warning on the dashboard, a browser notification or a phone push.</li>
      <li><strong>Open it on your phone.</strong> See <em>Access from other devices</em> at the bottom.</li>
    </ol>
  </section>

  <section class="card"><h2>Sources <small>where usage is read from</small></h2>
    ${c.sources.map((s) => `<div class="src" data-id="${s.id}">
      <div><strong>${esc(s.name)}</strong> <span class="chip">${esc(typeOf(s.type)?.label || s.type)}</span>
        <div class="note">${esc(s.path || s.url || 'default location')}</div><div class="note test-result" role="status"></div></div>
      <div class="actions"><button class="switch" role="switch" aria-checked="${s.enabled}" aria-label="${esc(s.name)} enabled" data-act="toggle"></button>
        <button class="btn" data-act="test">Test</button><button class="btn" data-act="edit">Edit</button><button class="btn danger" data-act="remove">Remove</button></div>
      ${helpHtml(typeOf(s.type))}
      <form class="form edit-form" hidden>${fieldsHtml(typeOf(s.type), s)}<button class="btn primary">Save changes</button></form>
    </div>`).join('') || '<p class="note">No sources yet. Add one below.</p>'}
  </section>

  <section class="card"><h2>Add a source</h2>
    <form class="form" id="add-form">
      <label>What do you want to track?<select name="type">${c.types.map((t) => `<option value="${t.type}">${esc(t.label)}</option>`).join('')}</select></label>
      <div id="add-help" class="full">${helpHtml(c.types[0], true)}</div>
      <div id="add-fields" class="form full">${fieldsHtml(c.types[0])}</div>
      <button class="btn primary">Add source</button>
    </form>
  </section>

  <section class="card"><h2>Budget alerts <small>warn before you overspend</small></h2>
    <p class="note">Each rule watches a total for today, this week (from Monday) or this month. You get a warning at the percentage you choose and again when the budget is passed. Leave App and Model on "Any" to watch everything.</p>
    ${(c.alerts || []).map((a) => `<div class="src" data-alert="${a.id}">
      <div><strong>${esc(a.name)}</strong> <span class="chip">${esc(scopeOf(a))}</span>
        <div class="note">${amount(a, a.limit)} ${PERIOD_LABEL[a.period]} · warn at ${a.warnAt}%${a.browser ? ' · browser notification' : ''}${a.webhook ? ` · ${esc(c.webhookFormats[a.webhookFormat] || 'webhook')}` : ''}</div>
        <div class="note test-result" role="status"></div></div>
      <div class="actions"><button class="switch" role="switch" aria-checked="${a.enabled !== false}" aria-label="${esc(a.name)} enabled" data-alert-act="toggle"></button>
        <button class="btn" data-alert-act="test">Send test</button><button class="btn" data-alert-act="edit">Edit</button><button class="btn danger" data-alert-act="remove">Remove</button></div>
      <form class="form alert-form" hidden>${alertFields(a, apps, models)}<button class="btn primary">Save changes</button></form>
    </div>`).join('')}
    <details class="add-alert"${(c.alerts || []).length ? '' : ' open'}><summary class="btn">Add a budget</summary>
      <form class="form alert-form" id="alert-add">${alertFields({ name: '', period: 'day', metric: 'cost', limit: '', warnAt: 80, browser: true, webhookFormat: 'ntfy' }, apps, models)}<button class="btn primary">Add budget</button></form>
    </details>
    <p class="note">Browser notifications: ${typeof Notification === 'undefined' ? 'not supported in this browser.' : Notification.permission === 'granted' ? 'allowed.' : `<button class="btn" data-notify>Allow notifications</button>`}</p>
    <details class="help"><summary>How do phone push alerts work?</summary>
      <ol class="steps">
        <li>Install the free <strong>ntfy</strong> app (Android or iPhone) and subscribe to a topic with a long random name, for example <code>my-ai-budget-7f3k9q</code>. Anyone who knows the topic can read it, so keep it unguessable.</li>
        <li>In the budget, set <em>Webhook URL</em> to <code>https://ntfy.sh/my-ai-budget-7f3k9q</code> and the format to <em>ntfy.sh</em>.</li>
        <li>Press <em>Send test</em>. Your phone should buzz within a few seconds.</li>
      </ol>
      <p class="note">Slack and Discord work the same way: create an incoming webhook in the channel settings, paste its URL and pick the matching format. Webhooks are sent by the monitor itself, even when no dashboard is open, once per budget, period and level.</p>
    </details>
  </section>

  <section class="card"><h2>Access from other devices</h2>
    <ol class="steps">
      <li>Start the monitor with <code>npm run lan</code> instead of <code>npm start</code>.</li>
      <li>Find this computer's address: on the same Wi-Fi it is the local IP (Windows: <code>ipconfig</code>; macOS: System Settings, Wi-Fi, Details). With Tailscale, use its 100.x address and the phone works from anywhere.</li>
      <li>On the phone, open <code>http://&lt;address&gt;:${c.port || 7788}</code> and enter the access token below. Use "Add to Home Screen" to keep it like an app.</li>
    </ol>
    <p class="note">Status: ${c.lan ? 'LAN access is on.' : 'only this computer can open the dashboard right now.'}</p>
    ${c.token ? `<p>Access token: <span class="token" id="token">${esc(c.token)}</span> <button class="btn" data-copy>Copy</button></p>` : ''}
    <p class="note">The token also lets another monitor read this one. Keep it private and do not open the port to the whole internet.</p>
  </section>

  ${c.cloud ? cloudCard(c.cloud) : ''}

  <section class="card"><h2>About the numbers</h2>
    <p class="note">Costs are API-equivalent estimates from the public LiteLLM price list, refreshed daily (the same source ccusage uses). On a subscription plan they show what the usage would cost on the API, not your bill. opencode reports its own cost. Local models count as $0. Rows marked "—" are models with no published price.</p>
  </section>`;
}
function cloudCard(cl) {
  return `<section class="card"><h2>Cloud mirror <small>check usage from anywhere</small></h2>
    <p class="note">Sends a copy of this dashboard to your own free Netlify site every minute, so your phone can open it without Tailscale or being on the same Wi-Fi. The cloud copy is read-only and protected by its own view token. Set up the site once with the steps in <code>cloud/README.md</code>.</p>
    <form class="form" id="cloud-form">
      <label>Your cloud site address<input type="text" name="url" value="${esc(cl.url)}" placeholder="https://my-ai-monitor.netlify.app" autocomplete="off"></label>
      <label>Push token (ATM_PUSH_TOKEN on the site)<input type="password" name="pushToken" value="${esc(cl.pushToken)}" autocomplete="off"></label>
      <label class="check"><input type="checkbox" name="enabled" ${cl.enabled ? 'checked' : ''}> Send updates</label>
      <label class="check"><input type="checkbox" name="includeTitles" ${cl.includeTitles ? 'checked' : ''}> Include session titles and project folders</label>
      <div class="actions full"><button class="btn primary">Save</button> <button class="btn" type="button" data-cloud-test>Push now</button></div>
    </form>
    <p class="note" role="status" id="cloud-status">Last push: ${esc(cl.last?.note || 'never')}</p>
    <p class="note">Titles are off by default because they often name clients or projects. Only totals per app, model and day, anonymous session rows, live server status and plan limits are sent.</p>
  </section>`;
}
function helpHtml(type, open = false) {
  const h = type?.help;
  if (!h) return '';
  return `<details class="help"${open ? ' open' : ''}><summary>How to set up ${esc(type.label)}</summary>
    <p class="note">${esc(h.what)}</p><ol class="steps">${h.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>${h.tips ? `<p class="note"><strong>Tip:</strong> ${esc(h.tips)}</p>` : ''}</details>`;
}
function fieldsHtml(type, values = {}) {
  if (!type) return '';
  return `<label>Display name<input type="text" name="name" value="${esc(values.name || type.label)}"></label>` + type.fields.map((f) =>
    `<label>${esc(f.label)}<input type="${f.secret ? 'password' : 'text'}" name="${f.key}" value="${esc(values[f.key] ?? '')}" placeholder="${esc(f.default ? `Default: ${f.default}` : '')}" autocomplete="off"></label>`).join('');
}
function alertFields(a, apps, models) {
  const c = state.config;
  const opt = (list, cur) => `<option value="">Any</option>${[...new Set([...list, cur].filter(Boolean))].map((v) => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}`;
  const sel = (name, map, cur) => `<select name="${name}">${Object.entries(map).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>`;
  return `<label>Name<input type="text" name="name" value="${esc(a.name)}" placeholder="e.g. Daily Claude budget" required></label>
    <label>App<select name="app">${opt(apps, a.app)}</select></label>
    <label>Model<select name="model">${opt(models, a.model)}</select></label>
    <label>Period${sel('period', c.periods, a.period)}</label>
    <label>Measure${sel('metric', { cost: 'Cost (USD)', tokens: 'Tokens' }, a.metric)}</label>
    <label>Budget (${cur()} for cost, count for tokens)<input type="text" inputmode="decimal" name="limit" value="${a.limit === '' || a.metric === 'tokens' ? esc(a.limit) : +(a.limit * fx.rates[cur()]).toFixed(2)}" placeholder="e.g. 50 or 50000000" required></label>
    <label>Warn at (%)<input type="text" inputmode="numeric" name="warnAt" value="${esc(a.warnAt ?? 80)}"></label>
    <label class="check"><input type="checkbox" name="browser" ${a.browser ? 'checked' : ''}> Browser notification</label>
    <label>Webhook URL (optional)<input type="password" name="webhook" value="${esc(a.webhook || '')}" placeholder="https://ntfy.sh/your-topic" autocomplete="off"></label>
    <label>Webhook format${sel('webhookFormat', c.webhookFormats, a.webhookFormat || 'ntfy')}</label>`;
}

// ---------- render ----------
const VIEWS = { overview, apps: appsView, models: modelsView, sessions: sessionsView, live: liveView, settings: settingsView };
function render() {
  document.querySelectorAll('[data-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
  document.querySelectorAll('[data-range]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.range === state.range)));
  $('.ranges').hidden = ['settings', 'live'].includes(state.tab);
  if (!state.data && state.tab !== 'settings') { view.innerHTML = '<p class="empty">Reading your usage logs…</p>'; return; }
  const focused = document.activeElement?.id;
  const pos = focused === 'q' ? document.activeElement.selectionStart : null;
  const banner = state.tab === 'settings' ? ''
    : DEMO ? '<p class="note demo-note">Demo with invented data. Run it on your own computer to see your real usage.</p>'
    : CLOUD && state.data?.pushedAt ? `<p class="note demo-note">Cloud copy, updated ${ago(state.data.pushedAt)}.</p>` : '';
  view.innerHTML = banner + VIEWS[state.tab]();
  if (focused === 'q') { const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target.closest('button, th[data-sort]');
  if (!t) return;
  if (t.dataset.tab || t.dataset.goto) { state.tab = t.dataset.tab || t.dataset.goto; saveUi(); if (state.tab === 'settings') await loadConfig(); render(); return; }
  if (t.dataset.range) { state.range = t.dataset.range; saveUi(); render(); return; }
  if ('metric' in t.dataset) { state.metric = state.metric === 'cost' ? 'tokens' : 'cost'; saveUi(); render(); return; }
  if (t.dataset.sort) { const k = t.dataset.sort; state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : -1 }; render(); return; }
  if ('copy' in t.dataset) { navigator.clipboard?.writeText($('#token').textContent); t.textContent = 'Copied'; return; }
  if (t.id === 'cur-btn') { openCurrency(); return; }
  if (t.dataset.cur) { state.currency = t.dataset.cur; saveUi(); $('#cur-dlg').close(); curLabel(); render(); return; }
  if ('curClose' in t.dataset) { $('#cur-dlg').close(); return; }
  if ('cloudTest' in t.dataset) { t.disabled = true; const r = await api('/api/cloud/test', 'POST'); $('#cloud-status').textContent = `Last push: ${r?.note || 'failed'}`; t.disabled = false; return; }
  if ('notify' in t.dataset) { await Notification.requestPermission(); notifyAlerts(); render(); return; }
  const row = t.closest('.src');
  if (!row) return;
  const out = row.querySelector('.test-result');
  if (t.dataset.alertAct) {
    const id = row.dataset.alert, act = t.dataset.alertAct;
    if (act === 'edit') { row.querySelector('.alert-form').hidden = !row.querySelector('.alert-form').hidden; return; }
    if (act === 'toggle') { t.disabled = true; await api(`/api/alerts/${id}`, 'PUT', { enabled: t.getAttribute('aria-checked') !== 'true' }); return refreshSettings(); }
    if (act === 'remove') { if (!confirm('Remove this budget?')) return; await api(`/api/alerts/${id}`, 'DELETE'); return refreshSettings(); }
    if (act === 'test') {
      out.textContent = 'Sending…'; t.disabled = true;
      const r = await api(`/api/alerts/${id}/test`, 'POST');
      out.textContent = r ? `${r.ok === false ? 'Failed' : 'OK'}: ${r.note || ''}` : 'Failed';
      t.disabled = false;
    }
    return;
  }
  if (!t.dataset.act) return;
  const id = row.dataset.id, act = t.dataset.act;
  if (act === 'edit') { row.querySelector('.edit-form').hidden = !row.querySelector('.edit-form').hidden; return; }
  if (act === 'toggle') { t.disabled = true; await api(`/api/sources/${id}`, 'PUT', { enabled: t.getAttribute('aria-checked') !== 'true' }); await loadConfig(); render(); return; }
  if (act === 'remove') { if (!confirm('Remove this source? Its usage stops showing until you add it again.')) return; await api(`/api/sources/${id}`, 'DELETE'); await loadConfig(); render(); return; }
  if (act === 'test') {
    out.textContent = 'Testing…'; t.disabled = true;
    const r = await api(`/api/sources/${id}/test`, 'POST');
    out.textContent = r ? `${r.ok === false ? 'Failed' : 'OK'}: ${r.note || ''}` : 'Failed';
    t.disabled = false;
  }
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'q') { state.q = e.target.value; render(); }
  if (e.target.id === 'cur-q') renderCurList();
});
document.addEventListener('change', (e) => {
  if (e.target.name === 'type' && e.target.closest('#add-form')) {
    const type = state.config.types.find((x) => x.type === e.target.value);
    $('#add-fields').innerHTML = fieldsHtml(type);
    $('#add-help').innerHTML = helpHtml(type, true);
  }
});
document.addEventListener('submit', async (e) => {
  const f = e.target;
  if (f.id === 'login-form') return;
  e.preventDefault();
  const body = Object.fromEntries(new FormData(f));
  const btn = f.querySelector('button.primary'); btn.disabled = true;
  let r;
  if (f.id === 'cloud-form') r = await api('/api/cloud', 'PUT', { ...body, enabled: f.elements.enabled.checked, includeTitles: f.elements.includeTitles.checked });
  else if (f.id === 'add-form') r = await api('/api/sources', 'POST', body);
  else if (f.classList.contains('edit-form')) r = await api(`/api/sources/${f.closest('.src').dataset.id}`, 'PUT', body);
  else if (f.classList.contains('alert-form')) {
    body.browser = f.elements.browser.checked; // unchecked boxes are missing from FormData
    if (body.metric === 'cost') body.limit = Number(body.limit) / fx.rates[cur()]; // budgets are stored in USD
    r = f.id === 'alert-add' ? await api('/api/alerts', 'POST', body) : await api(`/api/alerts/${f.closest('.src').dataset.alert}`, 'PUT', body);
  }
  if (r?.error) { btn.disabled = false; alert(r.error); return; }
  refreshSettings();
});
async function refreshSettings() {
  await loadConfig();
  const d = await api('/api/data'); // budgets show on Overview straight away
  if (d) state.data = d;
  render();
}

// ---------- data ----------
// Demo mode (public build): the same UI on invented data, nothing leaves the browser.
const DEMO = !!document.querySelector('meta[name="atm-demo"]');
// Cloud mode (your own Netlify site): read-only copy pushed from your computer, refreshed by polling.
const CLOUD = !!document.querySelector('meta[name="atm-cloud"]');
let demo = null;
async function api(url, method = 'GET', body) {
  if (DEMO) return demoApi(url, method, body);
  const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 401) { login(); return null; }
  return res.json().catch(() => null);
}
async function loadConfig() { state.config = await api('/api/config'); }

async function demoApi(url, method, body) {
  if (!demo) {
    const m = await import('./demo.js');
    const types = await fetch('demo-types.json').then((r) => r.json());
    demo = { ...m, sim: m.createDemo(), types, sources: structuredClone(m.demoSources), alerts: structuredClone(m.demoAlerts) };
  }
  const [, , kind, id, sub] = url.split('/');
  const list = kind === 'alerts' ? demo.alerts : demo.sources;
  if (url === '/api/data') {
    const snap = demo.sim.snapshot();
    snap.alerts = demo.alerts.filter((a) => a.enabled !== false).map((a) => ({ ...demo.evaluate(a, snap.daily), browser: a.browser }));
    return snap;
  }
  if (url === '/api/live') return demo.sim.live();
  if (url === '/api/rates') return fetch('demo-rates.json').then((r) => r.json()).catch(() => null);
  if (url === '/api/config') return { sources: demo.sources, alerts: demo.alerts, types: demo.types.types, periods: demo.types.periods, webhookFormats: demo.types.webhookFormats, lan: false, port: 7788 };
  if (sub === 'test') return { ok: true, note: 'Demo: nothing was contacted.' };
  if (method === 'POST') { list.push({ ...body, id: Math.random().toString(36).slice(2), enabled: true, limit: Number(body.limit) || 0, warnAt: Number(body.warnAt) || 80 }); return {}; }
  const i = list.findIndex((x) => x.id === id);
  if (method === 'DELETE') list.splice(i, 1);
  if (method === 'PUT') Object.assign(list[i], body, 'limit' in body ? { limit: Number(body.limit) || 0, warnAt: Number(body.warnAt) || 80 } : {});
  return {};
}

function login() {
  const d = $('#login');
  if (d.open) return;
  d.showModal();
  $('#login-form').onsubmit = async (e) => {
    e.preventDefault();
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: new FormData(e.target).get('token') }) });
    if (!res.ok) { $('#login-err').textContent = 'That token did not match.'; return; }
    d.close(); start();
  };
}

function onData(d) { state.data = d; notifyAlerts(); if (state.tab !== 'settings') render(); }
function connect() {
  if (CLOUD) {
    const tick = async () => {
      const d = await api('/api/data');
      if (d && !d.error) onData(d);
      $('#pulse').classList.toggle('on', !!d?.pushedAt && Date.now() - d.pushedAt < 3 * 60e3);
      state.live = (await api('/api/live')) || state.live; if (state.tab === 'live') render();
    };
    tick(); setInterval(tick, 30000);
    return;
  }
  if (DEMO) { // a new fake call every few seconds so the live parts move
    $('#pulse').classList.add('on');
    setInterval(async () => { demo.sim.tick(); onData(await api('/api/data')); state.live = demo.sim.live(); if (state.tab === 'live') render(); }, 4000);
    return;
  }
  const es = new EventSource('/api/events');
  es.addEventListener('data', (e) => onData(JSON.parse(e.data)));
  es.addEventListener('live', (e) => { state.live = JSON.parse(e.data); if (state.tab === 'live') render(); });
  es.onopen = () => $('#pulse').classList.add('on');
  es.onerror = () => $('#pulse').classList.remove('on');
}

async function start() {
  const d = await api('/api/data');
  if (!d) return;
  if (d.error) { view.innerHTML = `<p class="empty">${esc(d.error)}</p>`; return; }
  state.data = d;
  state.live = (await api('/api/live')) || [];
  const r = await api('/api/rates');
  if (r?.rates) Object.assign(fx, r);
  curLabel();
  if (state.tab === 'settings') await loadConfig();
  notifyAlerts();
  render();
  connect();
}
render();
start();
