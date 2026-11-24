import {test} from 'node:test';
import assert from 'node:assert/strict';
import {publicationRecord} from '../scripts/sync-public-memory.mjs';
import {mergeMemory,memoryGraph} from '../public/memory-model.mjs';
import {PostgresStore} from '../src/postgres.mjs';
test('only confirmed public fields leave receipt; failed and foreign posts excluded',()=>{
 const r={state:'published_chrome_verified',url:'https://x.com/alidadenull/status/2125224162880823479',text:'one more for the night shift.',secret:'PRIVATE',identityReference:'PRIVATE'};
 const p=publicationRecord(r);assert.equal(p.created,'2026-11-24T13:44:59.843Z');assert(!JSON.stringify(p).includes('PRIVATE'));
 assert.equal(publicationRecord({...r,state:'pending'}),null);assert.equal(publicationRecord({...r,url:r.url.replace('alidadenull','someone')}),null);
 assert.equal(publicationRecord({reply:r.url,text:r.text},true),null);
 assert.equal(publicationRecord({reply:r.url,text:r.text,confirmed:true},true).kind,'x_reply');
});
test('memory selection filters before limit; normal public feed unchanged',async()=>{
 let sql;const store=new PostgresStore({query:async q=>{sql=q;return {rows:[]};}});
 await store.publicJournal(true);assert.match(sql,/AND kind IN/);assert.match(sql,/LIMIT 500/);
 await store.publicJournal();assert.doesNotMatch(sql,/AND kind IN/);assert.match(sql,/LIMIT 50/);
});
test('browser records deduplicate and stale server attention is not current',()=>{
 const event=publicationRecord({state:'published_chrome_verified',url:'https://x.com/alidadenull/status/2125224162880823479',text:'new work'});
 const d=mergeMemory({events:[{...event,seq:'1'}],runtime:{workspace:{broadcast:{summary:'old'}}}},{events:[event]});
 assert.equal(d.events.length,1);const graph=memoryGraph(d);assert.equal(graph.latest,Date.parse(event.created));assert(!graph.nodes.some(n=>n.id==='attention'));
});
