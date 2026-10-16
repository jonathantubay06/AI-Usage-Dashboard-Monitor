import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore, dayKey } from '../src/store.js';
import { priceOf } from '../src/pricing.js';
import { createTailer } from '../src/tail.js';
import { writeFile, appendFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const rec = (over) => ({ ts: Date.now(), app: 'A', model: 'm', session: 's1', in: 10, out: 5, cacheRead: 100, cacheWrite: 20, reasoning: 0, cost: 0.5, ...over });

test('store aggregates daily, sessions and unpriced calls', () => {
  const s = createStore();
  s.push(rec());
  s.push(rec({ cost: null }));
  s.meta('A', 's1', { title: 'Hello' });
  const snap = s.snapshot();
  const d = snap.daily.find((x) => x.day === dayKey(Date.now()));
  assert.equal(d.calls, 2);
  assert.equal(d.in, 20);
  assert.equal(d.cost, 0.5);
  assert.equal(d.unpriced, 1);
  assert.equal(snap.sessions[0].title, 'Hello');
  assert.equal(snap.sessions[0].model, 'm');
});

test('unknown models stay unpriced', () => {
  assert.equal(priceOf('no-such-model-xyz', { in: 1, out: 1, cacheRead: 0, cacheWrite: 0 }), null);
});

test('tailer reads only appended complete lines', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'atm-'));
  const f = join(dir, 'a.jsonl');
  const lines = [];
  const t = createTailer((l) => lines.push(l));
  await writeFile(f, '{"a":1}\n{"b":');
  await t.read(f);
  assert.deepEqual(lines, ['{"a":1}']);
  await appendFile(f, '2}\n{"c":3}\n');
  await t.read(f);
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
});
