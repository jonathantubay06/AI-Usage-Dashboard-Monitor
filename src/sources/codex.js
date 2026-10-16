// OpenAI Codex CLI / app: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl
// token_count events carry running totals; the delta between events is one turn's usage.
// They also carry the plan's rate-limit percentages, shown as "limits".
import { watch } from 'node:fs';

import { join, basename } from 'node:path';
import { createTailer, listFiles, expandHome } from '../tail.js';
import { priceOf } from '../pricing.js';

export const info = {
  type: 'codex',
  label: 'Codex',
  kind: 'logs',
  fields: [{ key: 'path', label: 'Sessions folder', default: '~/.codex/sessions' }],
  help: {
    what: 'OpenAI Codex CLI and the Codex desktop app. Sessions are saved as rollout files that include token counts and your plan limits.',
    steps: [
      'Use Codex at least once so the sessions folder exists.',
      'Leave the folder empty to use the default: .codex/sessions in your home folder.',
      'If you set CODEX_HOME, point this at <CODEX_HOME>/sessions.',
    ],
    tips: 'The 5-hour and weekly plan limits shown under Live come from these files and update after each Codex turn.',
  },
};

export function create(cfg, store) {
  const app = cfg.name || 'Codex';
  const files = new Map(); // file -> { model, total }
  let latestLimitTs = 0;

  const tailer = createTailer((line, file) => {
    const isCtx = line.includes('"turn_context"') || line.includes('"session_meta"');
    if (!isCtx && !line.includes('"token_count"')) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    const st = files.get(file) || { model: 'unknown', total: null };
    files.set(file, st);
    const session = basename(file, '.jsonl').replace(/^rollout-[\dT-]+-/, '');
    const p = j.payload || {};
    if (isCtx) {
      if (p.model) st.model = p.model;
      if (p.cwd) store.meta(app, session, { project: p.cwd });
      return;
    }
    const ts = Date.parse(j.timestamp);
    if (p.rate_limits && ts >= latestLimitTs) {
      latestLimitTs = ts;
      const lim = (x) => x && { percent: x.used_percent, windowMinutes: x.window_minutes, resetsAt: x.resets_at * 1000 };
      store.setLimits(app, { primary: lim(p.rate_limits.primary), secondary: lim(p.rate_limits.secondary) });
    }
    const tot = p.info?.total_token_usage;
    if (!tot) return;
    const prev = st.total || { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
    const d = (k) => Math.max(0, (tot[k] || 0) - (prev[k] || 0));
    st.total = tot;
    const cached = d('cached_input_tokens');
    const t = { in: Math.max(0, d('input_tokens') - cached), out: d('output_tokens'), cacheRead: cached, cacheWrite: 0, reasoning: d('reasoning_output_tokens') };
    if (t.in + t.out + t.cacheRead === 0) return; // duplicate event
    store.push({ ts, app, model: st.model, session, ...t, cost: priceOf(st.model, t) });
  });

  let watcher, timer;
  const dir = expandHome(cfg.path || info.fields[0].default);
  const scan = async () => { for (const f of (await listFiles(dir, '.jsonl')).sort()) await tailer.read(f); };

  return {
    async start() {
      await scan();
      try { watcher = watch(dir, { recursive: true }, (_, f) => f?.endsWith('.jsonl') && tailer.read(join(dir, f))); } catch { /* poll only */ }
      timer = setInterval(scan, 30000);
    },
    stop() { watcher?.close(); clearInterval(timer); },
  };
}
