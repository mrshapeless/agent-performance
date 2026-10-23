import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store, run, dayKey, validate } from './kernel.mjs';
import { Gemini } from './gemini.mjs';

const identity = { name: 'TEST FIXTURE ONLY', voice: 'test', interests: 'test', visualDirection: 'test', summary: 'Synthetic test output, not an agent identity.' };
const provider = value => ({ quote: () => 100, generate: async () => ({ value, costMicrodollars: 20 }) });

test('identity survives restart; duplicate request cannot repeat paid call', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-test-'));
  let store = new Store(join(dir, 'test.sqlite'));
  try {
    await run(store, provider(identity), 'birth', 'one');
    store.close();
    store = new Store(join(dir, 'test.sqlite'));
    assert.deepEqual(store.identity(), identity);
    assert.equal((await run(store, { quote: () => 100, generate: () => { throw Error('must not run'); } }, 'birth', 'one')).status, 'already-recorded');
    assert.throws(() => store.begin('other', 'birth', 1), /Birth/);
    assert.equal(store.verify(), true);
  } finally { store.close(); rmSync(dir, { recursive: true }); }
});
test('Gemini telemetry has no shared cap and uses original day at settlement', () => {
  const s = new Store();
  try {
    const yesterday = new Date('2026-10-20T20:59:00Z');
    const today = new Date('2026-10-20T21:01:00Z');
    s.begin('a', 'step', 49_000_000, yesterday);
    s.begin('b', 'step', 2_000_000, yesterday);
    s.begin('c', 'step', 50_000_000, today);
    s.complete('a', 10, 'wait', {});
    assert.equal(s.used(dayKey(yesterday)), 2_000_010);
    assert.equal(s.used(dayKey(today)), 50_000_000);
  } finally { s.close(); }
});
test('failed model request remains held and is not retried', async () => {
  const s = new Store(); let calls = 0;
  const p = { quote: () => 100, generate: async () => { calls++; throw Error('timeout'); } };
  try {
    await assert.rejects(run(s, p, 'birth', 'a'), /timeout/);
    await run(s, p, 'birth', 'a');
    assert.equal(calls, 1);
    assert.equal(s.used(dayKey(new Date())), 100);
  } finally { s.close(); }
});
test('restricted tool vocabulary and tampering detection', () => {
  assert.throws(() => validate('step', { action: 'send_money', text: 'x', summary: 'x' }), /permitted/);
  const s = new Store();
  try {
    s.transaction(() => s.append('wait', { text: 'test' }));
    s.db.exec("UPDATE events SET payload='{}'");
    assert.equal(s.verify(), false);
  } finally { s.close(); }
});
test('Gemini request carries key in header and accounts for thinking tokens', async () => {
  const p = new Gemini({ GEMINI_API_KEY: 'test', GEMINI_MODEL: 'test-model',
    GEMINI_INPUT_USD_PER_MILLION: '1', GEMINI_OUTPUT_USD_PER_MILLION: '2' },
  async (url, options) => {
    assert.equal(url.includes('key='), false);
    assert.equal(options.headers['x-goog-api-key'], 'test');
    return { ok: true, json: async () => ({
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 20, thoughtsTokenCount: 30 },
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(identity) }] } }],
    }) };
  });
  assert.equal((await p.generate('system', 'prompt')).costMicrodollars, 110);
});
