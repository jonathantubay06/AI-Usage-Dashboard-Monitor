// Incremental JSONL reader: remembers a byte offset per file and only reads appended lines.
import { createReadStream } from 'node:fs';
import { stat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

// '~/x' -> '<home>/x', so shared configs and screenshots never contain a real user folder.
export const expandHome = (p) => (p && /^~[\\/]/.test(p) ? join(homedir(), p.slice(2)) : p);

export function createTailer(onLine) {
  const offsets = new Map(); // file -> byte offset of the first unread line

  async function read(file) {
    let size;
    try { size = (await stat(file)).size; } catch { return; }
    const from = offsets.get(file) || 0;
    if (size < from) offsets.set(file, 0); // truncated or replaced: start over
    if (size <= (offsets.get(file) || 0)) return;
    const start = offsets.get(file) || 0;
    let buf = '';
    let consumed = 0;
    for await (const chunk of createReadStream(file, { start, end: size - 1, encoding: 'utf8' })) {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consumed += Buffer.byteLength(line, 'utf8') + 1;
        if (line) onLine(line, file);
      }
    }
    offsets.set(file, start + consumed); // a trailing partial line is re-read next time
  }

  return { read };
}

export async function listFiles(dir, ext, out = []) {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) await listFiles(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}
