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

test('per-session budget flags the expensive chat and keeps titles out of webhook text', async () => {
  const { evaluate, message, sessionsOver } = await import('../src/alerts.js');
  const sessions = [
    { key: 'A:s1', id: 'aaaaaaaa11', app: 'A', title: 'Client Project X', last: Date.now(), cost: 120, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
    { key: 'A:s2', id: 'bbbbbbbb22', app: 'A', title: 'Small', last: Date.now(), cost: 10, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
  ];
  const rule = { id: 'r', name: 'Chat cap', perSession: true, metric: 'cost', limit: 100, warnAt: 80, period: 'day' };
  const st = evaluate(rule, [], sessions);
  assert.equal(st.level, 'over');
  assert.equal(st.count, 1);
  assert.equal(st.top.title, 'Client Project X');
  assert.equal(sessionsOver(rule, sessions).length, 1);
  const text = message(rule, { ...sessionsOver(rule, sessions)[0] });
  assert.ok(!text.includes('Client Project X'), 'title must not reach a webhook');
  assert.match(text, /session aaaaaa/);
});

test('per-session budget ignores chats idle for more than a day', async () => {
  const { evaluate } = await import('../src/alerts.js');
  const old = [{ key: 'A:s1', id: 'cccccccc33', app: 'A', title: 'Old', last: Date.now() - 3 * 864e5, cost: 500, in: 0, out: 0, cacheRead: 0, cacheWrite: 0 }];
  assert.equal(evaluate({ id: 'r', perSession: true, metric: 'cost', limit: 100, warnAt: 80, period: 'day' }, [], old).level, 'ok');
});
