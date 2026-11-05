import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PostgresStore} from '../src/postgres.mjs';
import {originalDelayMinutes,originalPublicationWindow} from '../src/original-cadence.mjs';
import {currentMemeEvidence} from '../src/meme-evidence.mjs';

test('publication delay is stable and a delayed poll cannot accumulate catch-up slots',async()=>{
 for(let i=0;i<100;i++){const n=originalDelayMinutes(i);assert.equal(n,120);assert.equal(n,originalDelayMinutes(i));}
 const last={seq:1,payload:JSON.stringify({postId:'one'}),created:'2026-11-03T10:00:00Z'};
 const query=async()=>({rows:[last]});const due=Date.parse(last.created)+originalDelayMinutes('one')*60000;
 assert.equal((await originalPublicationWindow(query,new Date(Date.parse(last.created)+61*60000))).due,false);
 assert.equal((await originalPublicationWindow(query,new Date(due-1))).due,false);
 assert.equal((await originalPublicationWindow(query,new Date(due))).due,true);
 assert.equal((await originalPublicationWindow(query,new Date(due+86400000))).due,true);
 last.created='2026-11-04T10:00:00Z';
 assert.equal((await originalPublicationWindow(query,new Date('2026-11-04T10:00:01Z'))).due,false);
});

test('atomic publication gate creates no operation or charge while waiting and leaves replies alone',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});
 try{
  await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Fixture'});
  await s.transaction(c=>s.append(c,'x_post',{postId:'previous'}));
  const blocked=await s.begin('x-publish-new','step',()=>({maximum:210000,originalPublication:true}));
  assert.equal(blocked.status,'cadence_wait');assert.equal(await s.operation('x-publish-new'),null);
  const reply=await s.begin('x-publish-reply-fixture','step',()=>({maximum:1}));assert.equal(reply.replay,false);
  await assert.rejects(s.begin('x-publish-other','step',()=>({maximum:1,originalPublication:true})),/UNRESOLVED_OPERATION/);
  await s.complete('x-publish-reply-fixture',1,{action:'x_reply'});
  await db.query("UPDATE agent_events SET created=$1 WHERE kind='x_post'",[new Date(Date.now()-120*60000).toISOString()]);
  assert.equal((await s.begin('x-publish-new','step',()=>({maximum:1,originalPublication:true}))).replay,false);
 }finally{await db.close();}
});

test('meme evidence expires, missing/corrupt/future evidence cannot become a current trend',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'meme-evidence-')),path=join(dir,'board.json'),now=new Date('2026-11-03T12:00:00Z');
 try{
  assert.equal(currentMemeEvidence(now,path).status,'refresh_needed');
  for(const value of ['broken',JSON.stringify({observedAt:'2026-11-01',formats:[]}),JSON.stringify({observedAt:'2026-11-04',formats:[]})]){await writeFile(path,value);assert.equal(currentMemeEvidence(now,path).status,'refresh_needed');}
  await writeFile(path,JSON.stringify({observedAt:'2026-11-03T11:00:00Z',formats:[{name:'Synthetic fixture'}]}));
  assert.equal(currentMemeEvidence(now,path).formats.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
