import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from './postgres.mjs';
import {createHandler} from './cloud.mjs';
import {toolProjectAPI,enqueueToolProject} from './tool-projects.mjs';
test('tool projects are private even with public view query',async()=>{
 const h=createHandler({env:{AGENT_ADMIN_SECRET:'x'.repeat(40)},openStore:()=>assert.fail('unauthorized database access')});
 for(const method of ['GET','POST'])assert.equal((await h(new Request('https://example.org/api/tool-projects?view=public',{method}))).status,401);
});
test('tool result returns to memory only after agent review; duplicate return cannot overwrite',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});
 try{
  await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic'});
  const brief={tool:'cursor',question:'Can a pause change a scene?',brief:'Make a small browser scene.',success:'Pause visibly changes the scene.',why:'Explore attention.'};
  assert.equal(await s.transaction(c=>enqueueToolProject(c,'test-one',brief)),'test-one');
  assert.equal(await s.transaction(c=>enqueueToolProject(c,'test-two',brief)),'test-one');
  const call=b=>toolProjectAPI(new Request('https://example.org/api/tool-projects',{method:'POST',body:JSON.stringify(b)}),s,{quote:()=>1,generate:async()=>({costMicrodollars:1,value:{decision:'revise',reason:'The report does not establish the pause interaction.',nextStep:'Verify the interaction and return actual observations.'}})});
  assert.equal((await call({action:'result',id:'test-one',result:'An unclaimed result'})).status,409);
  await call({action:'start',id:'test-one'});await call({action:'result',id:'test-one',result:'Built prototype; interaction not tested.'});
  assert.equal(await s.latest('workspace_note'),null);
  assert.equal((await call({action:'result',id:'test-one',result:'Overwrite'})).status,409);
  const reviewed=await (await call({action:'review',id:'test-one'})).json();assert.equal(reviewed.review.decision,'revise');
  assert.match((await s.latest('workspace_note')).text,/Verify the interaction/);
  assert.equal((await s.pool.query('SELECT state FROM agent_tool_projects')).rows[0].state,'reviewed');
 }finally{await db.close();}
});
