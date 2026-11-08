import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {PostgresStore} from '../src/postgres.mjs';
import {createHandler} from '../src/cloud.mjs';
import {toolProjectAPI,enqueueToolProject,gateToolReview} from '../src/tool-projects.mjs';
test('technical completion cannot bypass website delivery evidence',()=>{
 const review={decision:'accept',reason:'Tests passed',nextStep:'Ship'};
 for(const missing of ['desktop','mobile','brand','interaction']){
  const evidence={desktop:true,mobile:true,brand:true,interaction:true};delete evidence[missing];
  assert.equal(gateToolReview('cursor',review,evidence).decision,'revise');
 }
 assert.equal(gateToolReview('cursor',review,{desktop:true,mobile:true,brand:true,interaction:true}).decision,'accept');
 assert.equal(gateToolReview('grok',review,{}).decision,'accept');
});
test('tool projects are private even with public view query',async()=>{
 const h=createHandler({env:{AGENT_ADMIN_SECRET:'x'.repeat(40)},openStore:()=>assert.fail('unauthorized database access')});
 for(const method of ['GET','POST'])assert.equal((await h(new Request('https://example.org/api/tool-projects?view=public',{method}))).status,401);
});
test('tool result returns to memory only after agent review; duplicate return cannot overwrite',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const s=new PostgresStore({query:c.query,connect:async()=>c});
 try{
  await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic'});
  const brief={tool:'grok',question:'Can a pause change a scene?',brief:'Make a small browser scene.',success:'Pause visibly changes the scene.',why:'Explore attention.'};
  assert.equal(await s.transaction(c=>enqueueToolProject(c,'test-one',brief)),'test-one');
  assert.equal(await s.transaction(c=>enqueueToolProject(c,'test-two',brief)),'test-one');
  const call=b=>toolProjectAPI(new Request('https://example.org/api/tool-projects',{method:'POST',body:JSON.stringify(b)}),s,{quote:()=>1,generate:async()=>({costMicrodollars:1,value:{decision:'revise',reason:'The report does not establish the pause interaction.',nextStep:'Verify the interaction and return actual observations.'}})});
  assert.equal((await call({action:'result',id:'test-one',result:'An unclaimed result'})).status,409);
  assert.equal((await (await call({action:'start',id:'test-one'})).json()).claimed,true);
  assert.equal((await call({action:'start',id:'test-one'})).status,409);
  await call({action:'result',id:'test-one',result:'Built prototype; interaction not tested.'});
  assert.equal(await s.latest('workspace_note'),null);
  assert.equal((await call({action:'result',id:'test-one',result:'Overwrite'})).status,409);
  const reviewed=await (await call({action:'review',id:'test-one'})).json();assert.equal(reviewed.review.decision,'revise');
  assert.match((await s.latest('workspace_note')).text,/Verify the interaction/);
  assert.equal((await s.pool.query('SELECT state FROM agent_tool_projects')).rows[0].state,'reviewed');
  const saved=(await s.pool.query('SELECT brief FROM agent_tool_projects')).rows[0].brief;
  assert.equal(saved.deliveryContract.version,1);
  await call({action:'revise',id:'test-one'});
  const revision=(await s.pool.query('SELECT * FROM agent_tool_projects')).rows[0];
  assert.equal(revision.state,'running');assert.equal(revision.result,null);
  assert.equal(revision.deliveries.length,1);assert.equal(revision.deliveries[0].result,'Built prototype; interaction not tested.');
  await call({action:'result',id:'test-one',result:'Revised but no rendered checks',qualityEvidence:{brand:true}});
  assert.equal((await s.pool.query('SELECT quality_evidence FROM agent_tool_projects')).rows[0].quality_evidence.desktop,false);
  const second=await (await call({action:'review',id:'test-one'})).json();
  assert.equal(second.status,'reviewed');assert.equal(second.replay,undefined);
 }finally{await db.close();}
});

test('production tick selects external work without posts or workspace success, then does not duplicate it',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});let calls=0;
 try{await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic'});await s.transaction(c=>s.append(c,'studio_revision',{summary:'Active studio'}));
 const provider={quote:()=>1,generate:async()=>{calls++;return {costMicrodollars:1,value:{decision:'queue',reason:'Concrete unanswered interaction question',tool:'grok',question:'What makes a pause meaningful?',brief:'Compare three public interactive works with links and test implications.',success:'Three checked sources and one falsifiable next experiment.',why:'Choose interaction before building.'}}}};
 const h=createHandler({env:{CRON_SECRET:'s'.repeat(40),AGENT_ENABLED:'true',VERCEL_ENV:'production'},openStore:async()=>s,createProvider:()=>provider,now:()=>new Date('2026-11-04T20:00:00Z')});
 const response=await h(new Request('https://example.test/api/tick',{headers:{authorization:'Bearer '+'s'.repeat(40)}}));assert.equal(response.status,200);assert.equal((await response.json()).status,'tool_project_queued');assert.equal(calls,1);
 const {toolOpportunityStep}=await import('../src/tool-projects.mjs');assert.equal((await toolOpportunityStep(s,provider,new Date('2026-11-04T23:00:00Z'))).status,'tool_work_outstanding');assert.equal(calls,1);assert.equal((await db.query('SELECT * FROM agent_tool_projects')).rows.length,1);
 }finally{await db.close();}
});

test('empty opportunity check is bounded per hour and can honestly defer without an artificial task',async()=>{
 const {toolOpportunityStep}=await import('../src/tool-projects.mjs');const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});let calls=0;
 try{await s.begin('birth','birth',()=>({maximum:0}));await s.complete('birth',0,{name:'Synthetic'});const provider={quote:()=>1,generate:async()=>{calls++;return {costMicrodollars:1,value:{decision:'wait',reason:'Awaiting observations of the published interaction.',tool:'none',question:'',brief:'',success:'',why:''}}}};
 for(let m=0;m<4;m++)await toolOpportunityStep(s,provider,new Date(`2026-11-04T20:0${m}:00Z`));assert.equal(calls,1);assert.equal((await db.query('SELECT * FROM agent_tool_projects')).rows.length,0);await toolOpportunityStep(s,provider,new Date('2026-11-04T21:00:00Z'));assert.equal(calls,2);
 }finally{await db.close();}
});


test('restored Cursor executes new briefs but abandoned history cannot restart',async()=>{
 const {validateToolBrief,toolBriefSchema}=await import('../src/tool-projects.mjs');
 assert.deepEqual(toolBriefSchema.properties.tool.enum,['grok','cursor']);
 const brief={tool:'cursor',question:'What changes when a visitor scrubs time?',brief:'Build a small timing study.',success:'Scrubbing visibly changes the frame.',why:'Test timing.'};
 assert.equal(validateToolBrief(brief).tool,'cursor');
 const db=new PGlite();await db.exec(await readFile(new URL('../db/schema.sql',import.meta.url),'utf8'));
 const store={pool:{query:(q,a)=>db.query(q,a)}};
 try{
  await db.query("INSERT INTO agent_tool_projects(id,tool,brief,state,result,review) VALUES('old','cursor','{}','reviewed','saved partial report',$1)",[JSON.stringify({decision:'abandon'})]);
  const call=(action,id)=>toolProjectAPI(new Request('https://example.org/api/tool-projects',{method:'POST',body:JSON.stringify({action,id,result:'fake'})}),store,{});
  for(const action of ['start','revise','result','review']){const r=await call(action,'old');assert.equal(r.status,409);assert.equal((await r.json()).error,'PROJECT_ABANDONED');}
  assert.equal(await enqueueToolProject(store.pool,'new',brief),'new');
  assert.equal(await enqueueToolProject(store.pool,'duplicate',brief),'new');
  assert.equal((await (await call('start','new')).json()).claimed,true);
  assert.equal((await call('start','new')).status,409);
  await toolProjectAPI(new Request('https://example.org/api/tool-projects'),store,{});
  const rows=(await db.query('SELECT * FROM agent_tool_projects ORDER BY id')).rows;
  assert.equal(rows.find(r=>r.id==='new').state,'running');assert.equal(rows.find(r=>r.id==='old').result,'saved partial report');
 }finally{await db.close();}
});
