// Claude Code: ~/.claude/projects/<project>/<session>.jsonl (one line per event).
import { watch } from 'node:fs';

import { join, basename } from 'node:path';
import { createTailer, listFiles, expandHome } from '../tail.js';
import { priceOf } from '../pricing.js';

export const info = {
  type: 'claude-code',
  label: 'Claude Code',
  kind: 'logs',
  fields: [{ key: 'path', label: 'Projects folder', default: '~/.claude/projects' }],
  help: {
    what: 'Anthropic\'s Claude Code (terminal, desktop app, IDE extensions). Every chat writes a log of tokens used per message.',
    steps: [
      'Use Claude Code at least once so the log folder exists.',
      'Leave the folder empty to use the default: the .claude/projects folder in your home folder.',
      'If you moved CLAUDE_CONFIG_DIR, point this at <that folder>/projects.',
    ],
    tips: 'Cost is an API-equivalent estimate. On a Pro/Max/Team plan your bill is the subscription, not this number.',
  },
};

export function create(cfg, store) {
  const app = cfg.name || 'Claude Code';
  const seen = new Set();
  const tailer = createTailer((line, file) => {
    if (line.includes('"custom-title"') || line.includes('"ai-title"')) {
      try {
        const j = JSON.parse(line);
        const title = j.customTitle || j.aiTitle;
        if (title) store.meta(app, j.sessionId || basename(file, '.jsonl'), { title });
      } catch { /* ignore */ }
      return;
    }
    if (!line.includes('"output_tokens"') || !line.includes('"assistant"')) return;
    let j;
    try { j = JSON.parse(line); } catch { return; }
    const m = j.message;
    const u = m?.usage;
    if (j.type !== 'assistant' || !u || !m.model || m.model === '<synthetic>') return;
    const key = `${m.id}:${j.requestId}`; // the same message is logged once per content block
    if (seen.has(key)) return;
    seen.add(key);
    const t = {
      in: u.input_tokens || 0,
      out: u.output_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      reasoning: 0,
    };
    const session = j.sessionId || basename(file, '.jsonl');
    store.meta(app, session, { project: j.cwd });
    // 1-hour cache writes bill higher than 5-minute ones
    let cost = priceOf(m.model, { ...t, cacheWrite1h: u.cache_creation?.ephemeral_1h_input_tokens || 0 });
    if (cost != null) cost += (u.server_tool_use?.web_search_requests || 0) * 0.01; // $10 per 1,000 web searches
    store.push({ ts: Date.parse(j.timestamp), app, model: m.model, session, ...t, cost });
  });

  let watcher, timer;
  const dir = expandHome(cfg.path || info.fields[0].default);
  const scan = async () => { for (const f of await listFiles(dir, '.jsonl')) await tailer.read(f); };

  return {
    async start() {
      await scan();
      try {
        watcher = watch(dir, { recursive: true }, (_, f) => f?.endsWith('.jsonl') && tailer.read(join(dir, f)));
      } catch { /* recursive watch unsupported: polling below still works */ }
      timer = setInterval(scan, 30000);
    },
    stop() { watcher?.close(); clearInterval(timer); },
  };
}
