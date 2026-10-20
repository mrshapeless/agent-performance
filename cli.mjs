import { mkdirSync } from 'node:fs';
import { Store, run, dayKey } from './kernel.mjs';
import { Gemini } from './gemini.mjs';

const [command = 'status', id] = process.argv.slice(2);
mkdirSync('data', { recursive: true });
const store = new Store('data/agent.sqlite');
try {
  if (command === 'status') console.log(JSON.stringify({
    identity: store.identity(), todayMicrodollars: store.used(dayKey(new Date())),
    journalValid: store.verify(), events: store.events().length,
  }, null, 2));
  else if (command === 'journal') console.log(JSON.stringify(store.events(), null, 2));
  else if (['birth', 'step'].includes(command) && id)
    console.log(JSON.stringify(await run(store, new Gemini(), command, id), null, 2));
  else throw Error('Usage: node cli.mjs status | journal | birth <unique-id> | step <unique-id>');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally { store.close(); }
