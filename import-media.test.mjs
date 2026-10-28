import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from './postgres.mjs';
import {importApprovedMedia} from './import-media.mjs';
import {mediaStep,readyMedia} from './media.mjs';

test('import preserves bytes, is idempotent and keeps future jobs out of upload and publication',async()=>{
 const db=new PGlite();try{
  await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
  const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
  const store=new PostgresStore({query:c.query,connect:async()=>c});
  const bytes=Buffer.from('0000ftypfixture-mp4'),sha256=createHash('sha256').update(bytes).digest('hex');
  const batch={id:'test-commission',items:[{file:'clip.mp4',text:'An imagined scene.',alt:'A fictional portrait.',sha256,delayMinutes:240}]};
  const first=await importApprovedMedia(c,store,batch,async()=>bytes);assert.equal(first.length,1);
  assert.deepEqual(await importApprovedMedia(c,store,batch,async()=>assert.fail('must not reimport')),[]);
  const asset=await store.asset('media-test-commission-1-asset');assert.deepEqual(Buffer.from(asset.bytes),bytes);
  assert.equal((await store.operation('x-plan-test-commission-1')).result.provenance,'owner-approved-import');
  assert.equal((await mediaStep(store,{}, {X_ENABLED:'true'}, {},()=>assert.fail('future job must not upload'))).status,'no_media_jobs');
  await c.query("UPDATE agent_media_jobs SET state='ready'");assert.equal(await readyMedia(store),null);
  await c.query("UPDATE agent_media_jobs SET available_at=now()-interval '1 minute'");assert.equal(await readyMedia(store),null); // Imported clips still need current visual inspection.
  await assert.rejects(importApprovedMedia(c,store,{...batch,id:'bad',items:[{...batch.items[0],sha256:'0'.repeat(64)}]},async()=>bytes),/INVALID_IMPORTED_VIDEO/);
 }finally{await db.close()}
});
