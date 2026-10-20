import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';

import { constitution, validate } from './domain.mjs';
export { constitution, validate } from './domain.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const dayKey = date => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Moscow', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const money = n => {
  if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid microdollar amount');
};

export class Store {
  constructor(path = ':memory:') {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL,
        created TEXT NOT NULL, previous TEXT NOT NULL, digest TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reservations (
        id TEXT PRIMARY KEY, day TEXT NOT NULL, amount INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('held','settled')));
      CREATE TABLE IF NOT EXISTS operations (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL, status TEXT NOT NULL);
    `);
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  append(kind, payload) {
    const previous = this.db.prepare('SELECT digest FROM events ORDER BY seq DESC LIMIT 1').get()?.digest ?? '';
    const created = new Date().toISOString();
    const text = JSON.stringify(payload);
    const digest = hash(JSON.stringify([kind, text, created, previous]));
    this.db.prepare('INSERT INTO events(kind,payload,created,previous,digest) VALUES(?,?,?,?,?)')
      .run(kind, text, created, previous, digest);
  }
  events() {
    return this.db.prepare('SELECT * FROM events ORDER BY seq').all().map(row => ({ ...row, payload: JSON.parse(row.payload) }));
  }
  identity() { return this.events().filter(e => e.kind === 'identity').at(-1)?.payload ?? null; }
  used(day) { return this.db.prepare('SELECT COALESCE(SUM(amount),0) AS total FROM reservations WHERE day=?').get(day).total; }
  begin(id, kind, amount, date = new Date()) {
    money(amount);
    return this.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM operations WHERE id=?').get(id);
      if (existing) {
        if (existing.kind !== kind) throw Error('Operation ID belongs to another action');
        return false; // Includes unresolved calls: never blindly repeat a paid request.
      }
      if (kind === 'birth' && (this.identity() || this.db.prepare("SELECT id FROM operations WHERE kind='birth'").get()))
        throw Error('Birth already exists or is unresolved');
      const day = dayKey(date);
      if (this.used(day) + amount > 50_000_000) throw Error('Daily allowance exhausted');
      this.db.prepare("INSERT INTO reservations VALUES(?,?,?,'held')").run(id, day, amount);
      this.db.prepare("INSERT INTO operations VALUES(?,?,'pending')").run(id, kind);
      this.append('operation_started', { id, kind, reservedMicrodollars: amount, day });
      return true;
    });
  }
  complete(id, actual, kind, payload) {
    money(actual);
    this.transaction(() => {
      const row = this.db.prepare('SELECT * FROM reservations WHERE id=?').get(id);
      if (!row || row.status !== 'held') throw Error('No active reservation');
      // Keep actual provider costs even if a supplied price bound was wrong.
      this.db.prepare("UPDATE reservations SET amount=?,status='settled' WHERE id=?").run(actual, id);
      this.db.prepare("UPDATE operations SET status='complete' WHERE id=?").run(id);
      this.append(kind, payload);
      this.append('operation_completed', { id, actualMicrodollars: actual, exceededReservation: actual > row.amount });
    });
  }
  verify() {
    let previous = '';
    for (const row of this.db.prepare('SELECT * FROM events ORDER BY seq').all()) {
      if (row.previous !== previous || row.digest !== hash(JSON.stringify([row.kind, row.payload, row.created, previous])))
        return false;
      previous = row.digest;
    }
    return true;
  }
  close() { this.db.close(); }
}

export async function run(store, provider, kind, id) {
  if (!['birth', 'step'].includes(kind)) throw Error('Unknown operation');
  if (kind === 'step' && !store.identity()) throw Error('Create identity first');
  const prompt = kind === 'birth'
    ? 'Choose your initial identity. Return JSON strings: name, voice, interests, visualDirection, summary.'
    : `Choose the next action. Return JSON strings: action (draft_text or wait), text, summary.
Identity: ${JSON.stringify(store.identity())}
Recent public experience: ${JSON.stringify(store.events().filter(e => ['draft_text', 'wait'].includes(e.kind)).slice(-10))}`;
  const maximum = provider.quote(constitution, prompt);
  if (!store.begin(id, kind, maximum)) return { status: 'already-recorded', id };
  // On timeout, parsing failure, or process death, reservation remains held.
  // Reconciliation must use provider evidence, never an automatic refund/retry.
  const response = await provider.generate(constitution, prompt);
  const result = validate(kind, response.value);
  store.complete(id, response.costMicrodollars, kind === 'birth' ? 'identity' : result.action, result);
  return { status: 'complete', id, result };
}

