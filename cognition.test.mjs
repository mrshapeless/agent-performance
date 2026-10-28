import {reconcileCreativeRevision} from './creative-revision.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {cognitionStep,validateDecision} from './cognition.mjs';
import {recall,agenda,reconcileAgenda,lessons} from './memory.mjs';
import {scopedSQL} from './instance.mjs';
import {socialStep} from './integrations.mjs';
import {studioOperationId} from './studio.mjs';
const studio={projects:[{id:'forgotten-objects',status:'active',nextStep:'Study a forgotten object.'}]};
const choice=()=>({action:'write',taskId:'first-chapter',projectId:'forgotten-objects',objective:'Explore an abandoned chair.',nextStep:'Revise the ending before commissioning an illustration.',text:'The chair kept a seat for someone who had stopped arriving.',summary:'Start a story from a remembered object.',evidence:[],lesson:{id:'',claim:'',conditions:'',evidence:[],counterevidence:[],status:'hypothesis'}});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Test artist'});await s.transaction(c=>s.append(c,'studio_revision',studio));await reconcileCreativeRevision(s);return {s,db};}

test('working agenda excludes suspended goal backlog and prioritizes current commissions without deleting history',async()=>{
 const {s,db}=await fixture();try{
  for(const status of ['paused','completed','abandoned','active'])await s.pool.query('INSERT INTO agent_goals(id,status,objective,why,success) VALUES($1,$2,$3,$4,$5)',[status,status,'Synthetic objective','Synthetic reason','Synthetic outcome']);
  for(let i=0;i<12;i++)await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step,goal_id,updated) VALUES($1,'p','commissioned','Historical objective','Historical next step',$2,now())",['old-'+i,['paused','completed','abandoned'][i%3]]);
  for(let i=0;i<10;i++)await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step,goal_id,updated) VALUES($1,'p','active','Current objective','Current next step','active',$2)",['active-'+i,new Date(Date.UTC(2026,0,i+1)).toISOString()]);
  await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step,goal_id,updated) VALUES('current-commission','p','commissioned','Current commission','Execute current choice','active','2025-01-01')");
  await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step,updated) VALUES('independent','p','active','Independent choice','Consider it','2027-01-01')");
  const rows=await agenda(s);assert.equal(rows.length,8);assert.equal(rows[0].id,'current-commission');assert.equal(rows[1].id,'independent');assert.equal(rows[2].id,'active-9');assert.equal(rows.some(r=>r.id.startsWith('old-')),false);assert.equal(rows.some(r=>r.id==='active-0'),false);
  assert.equal((await s.pool.query("SELECT count(*)::int AS n FROM agent_agenda WHERE id LIKE 'old-%'")).rows[0].n,12);
  assert.deepEqual((await s.pool.query("SELECT status FROM agent_goals WHERE id='paused'")).rows[0],{status:'paused'});
 }finally{await db.close()}
});
test('archive reaches old evidence, separates editorial interpretation and excludes private sources',async()=>{
 const {s,db}=await fixture();try{
 await s.transaction(async c=>{await s.append(c,'record_note',{text:'The amber chair was an editorial suggestion.',prompt:'PRIVATE_PROMPT'});await s.append(c,'private_memory',{text:'amber PRIVATE_SECRET'});for(let i=0;i<80;i++)await s.append(c,'draft_text',{text:'Unrelated item '+i});});
 const found=await recall(s,['amber chair']);assert.equal(found.length,1);assert.equal(found[0].source,'editorial_record');assert.doesNotMatch(JSON.stringify(found),/PRIVATE/);
 await s.pool.query("INSERT INTO agent_room(id,session_id,nickname,role,text) VALUES('room-test','session','Visitor','visitor','I remember the amber chair')");
 assert.ok((await recall(s,['amber'])).some(r=>r.id==='room:room-test'));
 await s.pool.query("UPDATE agent_room SET hidden=true WHERE id='room-test'");
 assert.equal((await recall(s,['amber'],12,['room:room-test'])).some(r=>r.id==='room:room-test'),false);
 assert.match(scopedSQL('SELECT * FROM agent_agenda JOIN agent_lessons ON true'),/"generation_02"\.agent_lessons/);
 }finally{await db.close()}
});
test('recall and lessons do not promote self approval or publication to measured support',async()=>{
 const {s,db}=await fixture();try{
  await s.transaction(async c=>{
   await s.append(c,'media_review',{assetId:'test-collage',text:'Synthetic violet collage',decision:'publish',visualLanguageResult:'supported',summary:'Violet audience triumph'});
   await s.append(c,'media_review',{assetId:'test-collage',text:'Synthetic violet collage',decision:'reject',visualLanguageResult:'not_supported',evidenceProvenance:'independent_visual_audit',referenceComparison:'Coherent polished scene'});
   await s.append(c,'x_post',{assetId:'test-collage',text:'Synthetic violet collage',summary:'Violet audience triumph'});
  });
  const found=await recall(s,['violet']);assert.equal(found.filter(e=>e.kind==='media_review').length,1);assert.equal(found.find(e=>e.kind==='media_review').criticism.decision,'reject');assert.doesNotMatch(JSON.stringify(found),/audience triumph/);
  const ids=found.map(e=>e.id);
  await s.pool.query("INSERT INTO agent_lessons(id,claim,conditions,evidence,counterevidence,status) VALUES('violet','Violet creates higher tension','Synthetic condition',$1,'[]','supported')",[JSON.stringify(ids)]);
  const lesson=(await lessons(s))[0];assert.equal(lesson.status,'hypothesis');assert.equal(lesson.recordedStatus,'supported');assert.equal(lesson.supportVerified,false);assert.deepEqual(lesson.evidence,ids);
  assert.equal((await s.pool.query("SELECT status FROM agent_lessons WHERE id='violet'")).rows[0].status,'supported');
 }finally{await db.close();}
});
test('cognition checkpoints search, resumes after restart and writes once with atomic task state',async()=>{
 const {s,db}=await fixture();const now=new Date('2026-10-26T18:00:00Z');let calls=0;
 const provider={quote:()=>100,generate:async()=>({costMicrodollars:20,value:++calls===1?{queries:['forgotten chair']}:choice()})};
 try{assert.equal((await cognitionStep(s,provider,now)).status,'recall_prepared');const restarted=new PostgresStore(s.pool);assert.equal((await cognitionStep(restarted,provider,now)).choice,'write');assert.equal((await cognitionStep(restarted,provider,now)).replay,true);assert.equal(calls,2);assert.equal((await agenda(s))[0].artifact,choice().text);assert.equal((await s.status()).unresolved,0);
 }finally{await db.close()}
});
test('invented citations, duplicate commissioned tasks and unsupported lesson certainty are rejected',()=>{
 const v=choice();v.evidence=['999'];assert.throws(()=>validateDecision(v,studio,[],[],[]),/INVALID/);
 v.evidence=[];assert.throws(()=>validateDecision(v,studio,[],[{id:v.taskId,project_id:v.projectId,status:'commissioned'}],[]),/INVALID/);
 v.lesson={id:'chair-rule',claim:'Everyone likes chairs.',conditions:'Always.',evidence:['1'],counterevidence:[],status:'supported'};
 assert.throws(()=>validateDecision(v,studio,[{id:'1'}],[],[]),/INVALID/);
});
test('failed decision leaves no task, releases operation and cannot silently retry paid generation',async()=>{
 const {s,db}=await fixture();const now=new Date('2026-10-26T19:00:00Z');let calls=0;
 const provider={quote:()=>100,generate:async()=>({costMicrodollars:25,value:++calls===1?{queries:['chair']}:({...choice(),evidence:['invented']})})};
 try{await cognitionStep(s,provider,now);assert.equal((await cognitionStep(s,provider,now)).status,'decision_failed');assert.deepEqual(await agenda(s),[]);await cognitionStep(s,provider,now);assert.equal(calls,2);assert.equal((await s.status()).unresolved,0);
 }finally{await db.close()}
});
test('commission remains pending across restart and completes only with matching real publication',async()=>{
 const {s,db}=await fixture();try{
 await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step) VALUES('chapter-art','forgotten-objects','commissioned','Make art','Publish it')");
 await s.transaction(c=>s.append(c,'x_draft',{agendaId:'chapter-art',text:'Not published'}));await reconcileAgenda(s);assert.equal((await agenda(s))[0].status,'commissioned');
 await s.transaction(c=>s.append(c,'x_post',{agendaId:'chapter-art',postId:'123',text:'Published'}));await reconcileAgenda(new PostgresStore(s.pool));assert.deepEqual(await agenda(s),[]);
 await s.pool.query("UPDATE agent_agenda SET status='commissioned',version=3 WHERE id='chapter-art'");
 await reconcileAgenda(s);assert.equal((await agenda(s))[0].status,'commissioned');
 }finally{await db.close()}
});
test('social worker executes a commission exactly once and does not invent another post',async()=>{
 const {s,db}=await fixture();const now=new Date('2026-10-26T20:00:00Z');let posts=0;
 try{
 await s.transaction(c=>s.append(c,'cognitive_decision',{summary:'Make a chair work.'}));
 const sid=await studioOperationId(s,now);await s.begin(sid,'step',()=>({maximum:0}));await s.complete(sid,0,{action:'studio_revision',...studio});
 await s.pool.query("INSERT INTO agent_agenda(id,project_id,status,objective,next_step) VALUES('chair-piece','forgotten-objects','commissioned','A chair awaiting its visitor','Publish a short text')");
 const provider={quote:()=>10,generate:async(_s,p)=>{assert.match(p,/chair-piece/);return {costMicrodollars:5,value:{action:'x_draft',medium:'text',text:'The chair still expects you.',summary:'A first fragment.',intent:'project',projectId:'forgotten-objects'}}}};
 const x={post:async(_text,reply)=>{assert.equal(reply,null);posts++;return {id:'12345',url:'https://x.com/i/web/status/12345'}}};
 assert.equal((await socialStep(s,provider,{X_ENABLED:'true'},now,()=>x)).status,'planned');
 assert.equal((await socialStep(s,provider,{X_ENABLED:'true'},now,()=>x)).status,'published');
 assert.equal((await socialStep(s,provider,{X_ENABLED:'true'},now,()=>x)).status,'agent_working_independently');
 assert.equal(posts,1);assert.deepEqual(await agenda(s),[]);
 }finally{await db.close()}
});

test('cognition can request an extended work without publishing or losing its intent',async()=>{
 const {s,db}=await fixture();let calls=0;const now=new Date('2026-10-26T22:00:00Z');const v={...choice(),action:'develop',nextStep:'Develop a three-part illustrated story.'};const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls===1?{queries:['chair']}:v})};
 try{await cognitionStep(s,provider,now);assert.equal((await cognitionStep(s,provider,now)).choice,'develop');const request=await s.latest('work_request');assert.equal(request.projectId,v.projectId);assert.equal(request.text,v.text);assert.equal(await s.latest('x_post'),null);await cognitionStep(s,provider,now);assert.equal(calls,2);}finally{await db.close()}
});
