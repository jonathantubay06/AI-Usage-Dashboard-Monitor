// opencode: SQLite database (~/.local/share/opencode/opencode.db), opened read-only.
// Only the session and message tables are read; account/credential tables are never touched.
import { DatabaseSync } from 'node:sqlite';
import { expandHome } from '../tail.js';
import { priceOf } from '../pricing.js';

export const info = {
  type: 'opencode',
  label: 'opencode',
  kind: 'logs',
  fields: [{ key: 'path', label: 'Database file', default: '~/.local/share/opencode/opencode.db' }],
  help: {
    what: 'opencode (opencode.ai), the open-source coding agent. It stores sessions in a local SQLite database.',
    steps: [
      'Use opencode at least once.',
      'Leave the path empty to use the default: .local/share/opencode/opencode.db in your home folder (same on Windows, macOS and Linux).',
      'The file is opened read-only. Only session and message tables are read; saved logins are never touched.',
    ],
    tips: 'opencode records its own cost per message, so free models show $0.',
  },
};

export function create(cfg, store) {
  const app = cfg.name || 'opencode';
  const file = expandHome(cfg.path || info.fields[0].default);
  let last = 0;
  let timer;

  function poll() {
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      for (const s of db.prepare('SELECT id, title, directory FROM session WHERE time_updated > ?').all(last)) {
        store.meta(app, s.id, { title: s.title, project: s.directory });
      }
      const rows = db.prepare(
        `SELECT session_id, time_created, data FROM message
         WHERE time_created > ? AND json_extract(data, '$.role') = 'assistant' ORDER BY time_created`).all(last);
      for (const r of rows) {
        const d = JSON.parse(r.data);
        const tk = d.tokens || {};
        const t = { in: tk.input || 0, out: tk.output || 0, cacheRead: tk.cache?.read || 0, cacheWrite: tk.cache?.write || 0, reasoning: tk.reasoning || 0 };
        if (t.in + t.out + t.cacheRead + t.cacheWrite === 0) continue;
        const model = d.modelID || 'unknown';
        // opencode records its own cost; free models report 0. Fall back to the price list if absent.
        const cost = typeof d.cost === 'number' ? d.cost : priceOf(model, t);
        store.push({ ts: r.time_created, app, model, session: r.session_id, ...t, cost });
        last = Math.max(last, r.time_created);
      }
    } catch (e) {
      if (!poll.warned) console.warn(`[opencode] ${e.message}`);
      poll.warned = true;
    } finally {
      db?.close();
    }
  }

  return {
    async start() { poll(); timer = setInterval(poll, 10000); },
    stop() { clearInterval(timer); },
  };
}
