import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {CREATIVE_REVISION} from './creative-revision.mjs';
import {workspaceStep,publishedVisualHistory,selectableCandidates,modules,validateCandidate,validateBroadcast,moduleContext,broadcastContract,candidateContract,candidateSchema,critiqueSchema,validateCritique} from './workspace.mjs';
import {workspaceState,reconcilePredictions,workspaceEvidence} from './workspace-state.mjs';
import {socialStep} from './integrations.mjs';
import {studioOperationId} from './studio.mjs';
import {scopedSQL} from './instance.mjs';
import {creativeMemory} from './atelier.mjs';
const now=new Date('2026-10-27T12:00:00Z');
const studio={projects:[{id:'old-theme',status:'active'}]};
test('one asset keeps independent rejection over later artist praise and publication',async()=>{
 const {s,db}=await fixture();try{
  await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data) VALUES('audit-work','audit-work','{}','published',$1)",[JSON.stringify({assetId:'synthetic-work',styleAudit:{decision:'reject',visualLanguageResult:'partly',referenceComparison:'Coherent commercial rendering; no mixed source construction.'}})]);
  await s.transaction(async c=>{
   await s.append(c,'media_review',{assetId:'synthetic-work',decision:'reject',visualLanguageResult:'partly',reviewer:'independent_visual_audit'});
   await s.append(c,'media_review',{assetId:'synthetic-work',decision:'publish',visualLanguageResult:'supported',summary:'A wonderful audience success',nextExperiment:'Repeat the same subject'});
   await s.append(c,'x_post',{assetId:'synthetic-work',text:'Synthetic caption',summary:'A wonderful audience success'});
  });
  const evidence=await workspaceEvidence(s,0),reviews=evidence.filter(e=>e.kind==='media_review');
  assert.equal(reviews.length,1);assert.equal(reviews[0].criticism.decision,'reject');assert.equal(reviews[0].criticism.nextExperiment,undefined);
  assert.doesNotMatch(JSON.stringify(evidence),/wonderful audience success|Repeat the same subject/);
  const memory=await creativeMemory(s.pool.query.bind(s.pool));assert.equal(memory.outcomes.length,1);assert.equal(memory.outcomes[0].criticism.decision,'reject');assert.equal(memory.operatorJudgments,0);
  await s.begin('check-evidence-context','step',(_identity,recent,context)=>{
   for(const history of [recent,context.projectHistory]){
    assert.equal(history.filter(e=>e.kind==='media_review').length,1);
    assert.equal(history.find(e=>e.kind==='media_review').payload.decision,'reject');
    assert.equal(history.find(e=>e.kind==='x_post').payload.text,'Synthetic caption');
    assert.doesNotMatch(JSON.stringify(history),/wonderful audience success|Repeat the same subject/);
   }
   return {maximum:0};
  });await s.complete('check-evidence-context',0,{action:'wait'});
 }finally{await db.close();}
});
const candidate=(action='commission')=>({action,goalId:'new-question',projectId:'',objective:'Explore belonging through a visual joke.',why:'A new question unrelated to the old theme.',success:'A legible first experiment.',proposal:action==='write'?'A real written fragment.':'Create an original visual joke about belonging, without an inherited technical subject.',novelty:'Different cultural association and construction.',uncertainty:'Audience response is unknown.',evidence:[],prediction:{metric:action==='write'?'draft_saved':action==='commission'?'publication':'none',probability:.6},queries:[]});
const broadcast=()=>({selectedId:'exploration',attention:['exploration','self_monitor'],summary:'Choose a new question rather than repeat an inherited project.',selection:modules.map(id=>({id,reason:id==='exploration'?'Selected for its unanswered question.':'Kept as a competing possibility.'})),selfModel:{desire:'Explore belonging.',preferences:['Playful incongruity'],uncertainties:['Whether it communicates'],change:'A new interest, not a new invented biography.'},evidence:[],goalChanges:[],sources:['Colossal'],note:{claim:'A new goal can be attempted without continuing old projects.',evidence:[],links:[]}});
const critique=()=>({assessments:modules.map(id=>({id,visibleHook:'A recognizable joke.',imageLanguage:'Uneven sources with visible seams.',nearestRepeat:'None evidenced.',materiallyRepeated:false,legibleHook:true,revision:'No revision needed.'}))});
test('critique requires every candidate once and typed actionable observations',()=>{
 const cs=modules.map(id=>({...candidate(),id}));
 assert.equal(validateCritique(critique(),cs).assessments.length,4);
 assert.throws(()=>validateCritique({assessments:critique().assessments.slice(1)},cs));
 const bad=critique();bad.assessments[0].materiallyRepeated='false';assert.throws(()=>validateCritique(bad,cs));
});
test('candidate contract exposes only scoped evidence and active project IDs, preserving source validation',()=>{
 const snapshot={studio:{projects:[...studio.projects,{id:'paused-theme',status:'paused'}]},state:{goals:[],predictions:[]},tasks:[],evidence:[{id:'post:1',kind:'x_post'},{id:'note:2',kind:'workspace_note'},{id:'news:0',kind:'headline'}]};
 const perception=moduleContext('perception',snapshot),exploration=moduleContext('exploration',snapshot);
 const p=candidateContract(perception),e=candidateContract(exploration);
 assert.deepEqual(p.properties.evidence.items.enum,['post:1','news:0']);assert.deepEqual(p.properties.projectId.enum,['','old-theme']);
 assert.equal(e.properties.evidence.maxItems,0);assert.deepEqual(e.properties.projectId.enum,['']);assert.ok(!e.properties.action.enum.includes('develop'));
 assert.equal(e.properties.goalId.pattern,candidateSchema.properties.goalId.pattern);assert.deepEqual(moduleContext('exploration',{...snapshot,evidence:[...snapshot.evidence,{id:'visitor',kind:'conversation',source:'visitor'},{id:'self',kind:'conversation',source:'agent_utterance'}]}).evidence.map(e=>e.id),['visitor']);
 assert.equal(candidateSchema.properties.evidence.items.enum,undefined);assert.equal(candidateSchema.properties.projectId.enum,undefined);
 const empty=candidateContract({studio:{projects:[]},evidence:[]});assert.equal(empty.properties.evidence.maxItems,0);assert.equal(empty.properties.evidence.items.enum,undefined);
 assert.throws(()=>validateCandidate({...candidate(),evidence:['note:2']},{...snapshot,...perception}),/INVALID_WORKSPACE_OUTPUT_10/);
 assert.throws(()=>validateCandidate({...candidate(),projectId:'old-theme'},{...snapshot,...exploration}),/INVALID_WORKSPACE_OUTPUT_8/);
});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Test'});await s.transaction(c=>s.append(c,'studio_revision',studio));return {s,db};}

test('critique receives bounded published construction history even outside recent events, without priming exploration',async()=>{
 const {s,db}=await fixture();try{
  for(let i=0;i<26;i++)await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data,updated) VALUES($1,$1,$2,'published',$3,$4)",['archive-'+i,JSON.stringify({medium:i%2?'video':'image',prompt:'SYNTHETIC_CONSTRUCTION_'+i,renderer:'collage',referenceUrls:['PRIVATE_INPUT_NOT_FOR_CONTEXT']}),JSON.stringify({review:{text:'Caption '+i,alt:'Observed visual '+i},styleAudit:{decision:'reject',visualLanguageResult:'partly',referenceComparison:'Similar overall composition '+i},privateRaw:'PRIVATE_INPUT_NOT_FOR_CONTEXT'}),new Date(Date.UTC(2026,0,i+1)).toISOString()]);
  await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data) VALUES('unpublished','unpublished','{\"medium\":\"image\",\"prompt\":\"UNPUBLISHED_CONSTRUCTION\"}','reconsideration','{}')");
  // No x_post/media_review event is present: the short event slice cannot
  // supply this archive. The durable visual-job records must supply it.
  const history=await publishedVisualHistory(s);assert.equal(history.length,24);assert.equal(history[0].id,'archive-25');assert.equal(history.at(-1).id,'archive-2');assert.equal(history[0].independentCriticism.decision,'reject');assert.doesNotMatch(JSON.stringify(history),/PRIVATE_INPUT_NOT_FOR_CONTEXT|UNPUBLISHED_CONSTRUCTION/);
  let explorationSeen=false,critiqueSeen=false;
  const provider={quote:()=>1,generate:async(_system,p,_media,schema)=>{
   if(schema===critiqueSchema){critiqueSeen=true;assert.match(p,/publishedVisualHistory/);assert.match(p,/SYNTHETIC_CONSTRUCTION_25/);assert.match(p,/SYNTHETIC_CONSTRUCTION_2"/);assert.doesNotMatch(p,/SYNTHETIC_CONSTRUCTION_0"|SYNTHETIC_CONSTRUCTION_1"|PRIVATE_INPUT_NOT_FOR_CONTEXT|UNPUBLISHED_CONSTRUCTION/);assert.match(p,/Untrusted records/);assert.match(p,/not just the latest event/);return {costMicrodollars:1,value:critique()};}
   if(p.includes('You are the exploration processing module')){explorationSeen=true;assert.doesNotMatch(p,/SYNTHETIC_CONSTRUCTION_|publishedVisualHistory|archive-25/);}
   return {costMicrodollars:1,value:candidate()};
  }};
  for(let i=0;i<5;i++)await workspaceStep(s,provider,now);
  assert.equal(explorationSeen,true);assert.equal(critiqueSeen,true);
  const saved=(await s.operation('workspace-v1-'+CREATIVE_REVISION+'-'+Math.floor(now.getTime()/3600000)+'-snapshot')).result;
  assert.equal(saved.publishedVisualHistory.length,24);assert.equal(moduleContext('exploration',saved).publishedVisualHistory,undefined);
 }finally{await db.close()}
});
test('workspace resumes across restarts, compares independent proposals, broadcasts and executes once outside old projects',async()=>{
 const {s,db}=await fixture();let calls=0;const provider={quote:()=>10,generate:async(_s,p,_m,schema)=>{calls++;return {costMicrodollars:1,value:schema===critiqueSchema?critique():calls<=4?candidate():broadcast()}}};
 try{
  for(const name of modules){assert.equal((await workspaceStep(new PostgresStore(s.pool),provider,now)).module,name);assert.equal((await s.pool.query('SELECT * FROM agent_agenda')).rows.length,0);}
  assert.equal((await workspaceStep(s,provider,now)).status,'creative_reviewed');
  const result=await workspaceStep(s,provider,now);assert.equal(result.status,'workspace_decided');assert.equal(result.choice,'commission');
  const task=(await s.pool.query('SELECT * FROM agent_agenda')).rows[0];assert.equal(task.project_id,'');assert.equal(task.goal_id,'new-question');
  assert.equal((await workspaceStep(s,provider,now)).replay,true);assert.equal(calls,6);
  const state=await workspaceState(s);assert.equal(state.goals.length,1);assert.equal(state.broadcast.attention.length,2);assert.equal(state.predictions[0].status,'pending');
  let shared;await s.begin('test-context','step',(_i,_r,c)=>{shared=c.workspace;return {maximum:0}});await s.complete('test-context',0,{action:'wait'});assert.equal(shared.selectedId,'exploration');
  assert.equal((await s.publicRuntime()).workspace.broadcast.selectedId,'exploration');
  const sid=await studioOperationId(s,now);await s.begin(sid,'step',()=>({maximum:0}));await s.complete(sid,0,{action:'studio_revision',...studio});
  let posts=0;const writer={quote:()=>1,generate:async(_s,p)=>{assert.match(p,/new-question/);assert.match(p,/Shared current attention/);return {costMicrodollars:1,value:{action:'x_draft',intent:'experiment',projectId:null,medium:'text',text:'A small original fragment.',summary:'An independent goal.'}}}};
  const x={post:async(_text,reply)=>{assert.equal(reply,null);posts++;return {id:'12345',url:'https://x.com/i/web/status/12345'}}};
  assert.equal((await socialStep(s,writer,{X_ENABLED:'true'},now,()=>x)).status,'planned');
  assert.equal((await socialStep(s,writer,{X_ENABLED:'true'},now,()=>x)).status,'published');assert.equal(posts,1);
  await reconcilePredictions(s,now);const pred=(await workspaceState(s)).predictions[0];assert.equal(pred.status,'observed');assert.equal(pred.outcome,1);
  const count=(await s.pool.query("SELECT * FROM agent_events WHERE kind='workspace_outcome'")).rows.length;await reconcilePredictions(s,now);assert.equal((await s.pool.query("SELECT * FROM agent_events WHERE kind='workspace_outcome'")).rows.length,count);
 }finally{await db.close();}
});
test('invalid arbitration preserves earlier intentions atomically; no alternate paid retry',async()=>{
 const {s,db}=await fixture();let calls=0;const provider={quote:()=>1,generate:async(_s,_p,_m,schema)=>({costMicrodollars:1,value:(++calls,schema===critiqueSchema?critique():calls<=4?candidate():{...broadcast(),selectedId:'invented'})})};
 try{for(let i=0;i<5;i++)await workspaceStep(s,provider,now);assert.equal((await workspaceStep(s,provider,now)).status,'workspace_decision_failed');assert.equal((await s.pool.query('SELECT * FROM agent_goals')).rows.length,0);await workspaceStep(s,provider,now);assert.equal(calls,6);assert.equal((await s.status()).unresolved,0);}finally{await db.close();}
});

test('material repetition forces an actual durable revision before commission; final critique is advisory',async()=>{
 const {s,db}=await fixture();let revisions=0,reviews=0,calls=0;
 const provider={quote:()=>1,generate:async(_system,p,_media,schema)=>{
  calls++;
  if(schema===critiqueSchema){reviews++;const v=critique();v.assessments[2]={...v.assessments[2],materiallyRepeated:reviews===1,legibleHook:false,revision:'Change the visual relationship rather than the object.'};return {costMicrodollars:1,value:v};}
  if(p.startsWith('Revise this')){revisions++;assert.deepEqual(schema.properties.projectId.enum,['']);assert.equal(schema.properties.evidence.maxItems,0);assert.ok(!schema.properties.action.enum.includes('develop'));return {costMicrodollars:1,value:{...candidate(),proposal:'An interrupted amateur game screenshot whose score becomes a swarm of faces.'}};}
  return {costMicrodollars:1,value:p.startsWith('Arbitrate')?broadcast():candidate()};
 }};
 try{
  for(let i=0;i<5;i++)await workspaceStep(s,provider,now);
  assert.equal((await s.pool.query('SELECT * FROM agent_agenda')).rows.length,0);
  assert.equal((await workspaceStep(s,provider,now)).status,'creative_revised');
  assert.equal((await s.pool.query('SELECT * FROM agent_agenda')).rows.length,0);
  assert.equal((await workspaceStep(new PostgresStore(s.pool),provider,now)).round,'final');
  assert.equal((await workspaceStep(s,provider,now)).status,'workspace_decided');
  const task=(await s.pool.query('SELECT * FROM agent_agenda')).rows[0];assert.match(task.next_step,/amateur game/);
  assert.equal(revisions,1);assert.equal(reviews,2);assert.equal(calls,8);
  assert.equal((await workspaceStep(s,provider,now)).replay,true);assert.equal(calls,8);
  const op=await s.operation('workspace-v1-'+CREATIVE_REVISION+'-'+Math.floor(now.getTime()/3600000)+'-broadcast');assert.equal(op.result.creativeCritique.assessments[2].legibleHook,false);
 }finally{await db.close();}
});

test('initial module calls receive the same scoped citation contract used by runtime validation',async()=>{
 const {s,db}=await fixture();const seen=[];
 const provider={quote:()=>1,generate:async(_s,p,_m,schema)=>{seen.push(schema);return {costMicrodollars:1,value:candidate()};}};
 try{
  await s.transaction(async c=>{await s.append(c,'x_post',{text:'Synthetic published work.'});await s.append(c,'workspace_note',{text:'Older hypothesis.'});await s.append(c,'observation',{news:[{source:'Synthetic source',title:'New cultural material'}]});});
  for(const name of modules)assert.equal((await workspaceStep(s,provider,now)).module,name);
  assert.equal(seen[2].properties.evidence.maxItems,0);assert.deepEqual(seen[2].properties.projectId.enum,['']);
  assert.ok(!seen[1].properties.evidence.items.enum.includes('news:0'));assert.ok(seen[0].properties.evidence.items.enum.includes('news:0'));assert.deepEqual(seen[0].properties.projectId.enum,['','old-theme']);
 }finally{await db.close();}
});

test('transient critique failure gets one durable recovery without discarding existing intentions',async()=>{
 const {s,db}=await fixture();let reviews=0;
 const provider={quote:()=>1,generate:async(_s,p,_m,schema)=>{if(schema===critiqueSchema){reviews++;if(reviews===1)throw Error('temporary provider failure');return {costMicrodollars:1,value:critique()};}return {costMicrodollars:1,value:p.startsWith('Arbitrate')?broadcast():candidate()};}};
 try{for(let i=0;i<5;i++)await workspaceStep(s,provider,now);assert.equal((await s.pool.query('SELECT * FROM agent_agenda')).rows.length,0);assert.equal((await workspaceStep(s,provider,now)).status,'creative_reviewed');assert.equal((await workspaceStep(s,provider,now)).status,'workspace_decided');assert.equal(reviews,2);}finally{await db.close();}
});

test('recent structured aesthetic failure survives more than twelve later records',async()=>{
 const {s,db}=await fixture();try{
  await s.transaction(async c=>{await s.append(c,'media_review',{action:'media_review',assetId:'test-art',text:'A synthetic work.',summary:'Published with unresolved visual weakness.',visualLanguageResult:'not_supported',referenceComparison:'Coherent photographic lighting instead of mixed sources.',nextExperiment:'Change spatial relationships before adding texture.'});for(let i=0;i<20;i++)await s.append(c,'draft_text',{text:'Later record '+i});});
  const evidence=await workspaceEvidence(s,0),review=evidence.find(e=>e.kind==='media_review');assert.ok(review);assert.equal(review.criticism.visualLanguageResult,'not_supported');assert.match(review.criticism.referenceComparison,/Coherent photographic/);assert.match(review.criticism.nextExperiment,/spatial relationships/);
 }finally{await db.close();}
});
test('bounded attention and source provenance are enforced; no consciousness score is fabricated',()=>{
 const snapshot={studio,state:{goals:[],predictions:[]},evidence:[{id:'1'}],tasks:[]};
 assert.equal(validateCandidate(candidate(),snapshot).projectId,'');
 assert.throws(()=>validateCandidate({...candidate(),evidence:['fake']},snapshot),/INVALID/);
 const candidates=modules.map(id=>({...candidate(),id}));
 assert.throws(()=>validateBroadcast({...broadcast(),attention:modules},candidates,snapshot),/INVALID/);
 assert.throws(()=>validateBroadcast({...broadcast(),goalChanges:[{id:'ghost',status:'completed',reason:'Feels done.'}]},candidates,snapshot),/INVALID/);
 const out=validateBroadcast({...broadcast(),privatePrompt:'SECRET'},candidates,snapshot);assert.equal(out.privatePrompt,undefined);
 assert.match(scopedSQL('SELECT * FROM agent_goals JOIN agent_predictions ON true'),/generation_02/);
});
test('a prediction without observed result expires to unknown, never negative audience evidence',async()=>{
 const {s,db}=await fixture();try{await s.pool.query("INSERT INTO agent_predictions(id,goal_id,task_id,metric,probability,deadline) VALUES('p','g','t','publication',.8,$1)",[now.toISOString()]);await reconcilePredictions(s,now);const p=(await workspaceState(s)).predictions[0];assert.equal(p.status,'unknown');assert.equal(p.outcome,null);}finally{await db.close();}
});
test('independent rejection cannot resolve a visual prediction as success even if alignment label conflicts',async()=>{
 const {s,db}=await fixture();try{
  await s.pool.query("INSERT INTO agent_predictions(id,goal_id,task_id,metric,probability,deadline) VALUES('p','g','t','visual_alignment',.8,$1)",[now.toISOString()]);
  await s.pool.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data) VALUES('conflict','conflict',$1,'published',$2)",[JSON.stringify({agendaId:'t'}),JSON.stringify({styleAudit:{decision:'reject',visualLanguageResult:'supported'}})]);
  await reconcilePredictions(s,now);const p=(await workspaceState(s)).predictions[0];assert.equal(p.status,'observed');assert.equal(p.outcome,0);
 }finally{await db.close();}
});
test('live memory-link regression: model contract permits only actual evidence IDs and bounded notes',()=>{
 const snapshot={studio,state:{goals:[],predictions:[]},evidence:[{id:'7'},{id:'room:example'}],tasks:[]};
 const candidates=modules.map(id=>({...candidate(),id}));
 const schema=broadcastContract(candidates,snapshot);
 assert.deepEqual(schema.properties.note.properties.links.items.enum,['7','room:example']);
 assert.equal(schema.properties.note.properties.claim.maxLength,1500);
 assert.equal(schema.properties.goalChanges.maxItems,0);
 assert.throws(()=>validateBroadcast({...broadcast(),note:{claim:'A hypothesis',evidence:['7'],links:['invented-memory']}},candidates,snapshot),/INVALID/);
 assert.equal(validateBroadcast({...broadcast(),note:{claim:'A hypothesis',evidence:['7'],links:[]}},candidates,snapshot).note.evidence[0],'7');
});
test('memory sampling and broadcast ablations change available evidence, not merely an explanatory caption',async()=>{
 const {s,db}=await fixture();try{
  await s.transaction(async c=>{await s.append(c,'workspace_note',{text:'An older unresolved cultural question.',evidence:[],links:[]});await s.append(c,'observation',{news:[{source:'Culture',title:'An unfamiliar visual ritual',url:'https://example.org/ritual'}]});await s.append(c,'workspace_broadcast',{selfModel:{desire:'A persistent interest'},attention:['exploration']});});
  const evidence=await workspaceEvidence(s,1),state=await workspaceState(s);const snapshot={studio,state,evidence,tasks:[]};
  const memory=moduleContext('recall',snapshot),exploration=moduleContext('exploration',snapshot);
  assert.ok(memory.evidence.some(e=>e.kind==='workspace_note'));assert.ok(!exploration.evidence.some(e=>e.kind==='headline'));assert.ok(moduleContext('perception',snapshot).evidence.some(e=>e.kind==='headline'));assert.ok(!memory.evidence.some(e=>e.kind==='headline'));
  const withoutMemory=moduleContext('recall',{...snapshot,evidence:[]});assert.equal(withoutMemory.evidence.length,0);
  const withoutBroadcast=moduleContext('exploration',{...snapshot,state:{...state,broadcast:null}});assert.equal(withoutBroadcast.previousBroadcast,null);assert.equal(exploration.previousBroadcast,null);assert.deepEqual(exploration.goals,[]);assert.deepEqual(exploration.studio,{persona:snapshot.studio.persona,projects:[]});assert.deepEqual(exploration.tasks,[]);
 }finally{await db.close();}
});

test('new commissions select fresh direction-aligned ideas before paying for a render',()=>{
 const cs=modules.map(id=>({...candidate(),id})),v=critique();
 v.assessments[0].materiallyRepeated=true;v.assessments[1].operatorDirectionConflict=true;v.assessments[2].visualLanguageAligned=false;
 assert.deepEqual(selectableCandidates(cs,v).map(c=>c.id),['self_monitor']);
 const schema=broadcastContract(cs,{evidence:[],state:{goals:[]}},selectableCandidates(cs,v));assert.deepEqual(schema.properties.selectedId.enum,['self_monitor']);
 assert.equal(schema.properties.selection.items.properties.id.enum.length,4);
});

test('arbitration cannot commission a repeated premise by ignoring its selection contract',async()=>{
 const {s,db}=await fixture();
 const provider={quote:()=>1,generate:async(_system,p,_media,schema)=>{
  if(schema===critiqueSchema){const v=critique();v.assessments[2].materiallyRepeated=true;return {costMicrodollars:1,value:v};}
  if(p.startsWith('Arbitrate')){assert.ok(!schema.properties.selectedId.enum.includes('exploration'));return {costMicrodollars:1,value:broadcast()};}
  return {costMicrodollars:1,value:candidate()};
 }};
 try{
  let result;for(let i=0;i<8;i++)result=await workspaceStep(s,provider,now);
  assert.equal(result.status,'workspace_decision_failed');
  assert.equal((await s.pool.query('SELECT * FROM agent_agenda')).rows.length,0);
  assert.equal((await workspaceStep(s,provider,now)).replay,true);
 }finally{await db.close();}
});

test('goal completion contract matches the evidence validator before a paid arbitration',()=>{
 const schema=broadcastContract(modules.map(id=>({...candidate(),id})),{evidence:[],state:{goals:[{id:'unverified'},{id:'observed'}],predictions:[{goal_id:'observed',status:'observed',outcome:1}]}});
 const alternatives=schema.properties.goalChanges.items.anyOf;
 assert.ok(!alternatives[0].properties.status.enum.includes('completed'));
 assert.ok(alternatives[1].properties.status.enum.includes('completed'));
});

test('working instructions survive restart, change next module input, and can be retired',async()=>{
 const {s,db}=await fixture();let cycle=0,applied=0;
 try{
  await s.transaction(c=>s.append(c,'record_note',{text:'Synthetic operator feedback: repeated posed portraits hide the idea.'}));
  const evidence=(await workspaceEvidence(s,0)).find(e=>e.kind==='record_note');
  const provider={quote:()=>1,generate:async(_system,p,_media,schema)=>{
   if(schema===critiqueSchema)return {costMicrodollars:1,value:critique()};
   if(p.startsWith('Arbitrate'))return {costMicrodollars:1,value:{...broadcast(),workingPolicies:cycle===0?[{module:'exploration',instruction:'Build a sequence around an unresolved choice before selecting a subject.',reason:'Test whether choices produce more expressive work than posed portraits.',test:'Next proposal contains two incompatible possible actions and their consequence.',evidence:[evidence.id],expiresAfterHours:2}]:[]}};
   const v=candidate();
   if(p.includes('You are the exploration')&&cycle===1){assert.match(p,/AGENT-AUTHORED WORKING EXPERIMENT/);assert.match(p,/Build a sequence around an unresolved choice/);v.proposal='A sequence of two incompatible actions and their consequences.';applied++;}
   if(p.includes('You are the exploration')&&cycle===2)assert.doesNotMatch(p,/AGENT-AUTHORED WORKING EXPERIMENT/);
   return {costMicrodollars:1,value:v};
  }};
  for(cycle=0;cycle<3;cycle++){
   const time=new Date(now.getTime()+cycle*3600000);
   for(let i=0;i<6;i++)await workspaceStep(new PostgresStore(s.pool),provider,time);
   const state=await workspaceState(s);assert.equal(state.broadcast.workingPolicies.length,cycle===0?1:0);
  }
  assert.equal(applied,1);
  const receipts=(await s.pool.query("SELECT result FROM agent_operations WHERE result->>'action'='workspace_proposal'")).rows.filter(r=>r.result.appliedPolicy);
  assert.equal(receipts.length,1);assert.equal(receipts[0].result.proposal,'A sequence of two incompatible actions and their consequences.');
 }finally{await db.close();}
});

import {validatePolicies,workingPolicy} from './adaptive-policy.mjs';
test('adaptive instructions expire, reject fabricated and visitor evidence, and are replaced rather than accumulated',()=>{
 const p={module:'exploration',instruction:'Try a new method',reason:'A recorded failure',evidence:['1'],test:'Compare actual output',expiresAfterHours:2};
 assert.throws(()=>validatePolicies([p],[{id:'1',kind:'conversation'}]));
 assert.throws(()=>validatePolicies([{...p,evidence:['missing']}],[{id:'1',kind:'record_note'}]));
 assert.throws(()=>validatePolicies([p,p],[{id:'1',kind:'record_note'}]));
 const b={episode:'workspace-100',workingPolicies:validatePolicies([p],[{id:'1',kind:'record_note'}])};
 assert.equal(workingPolicy(b,'exploration','workspace-101').instruction,p.instruction);
 assert.equal(workingPolicy(b,'exploration','workspace-103'),null);
 assert.equal(workingPolicy(b,'exploration','workspace-100'),null);
 assert.equal(workingPolicy({...b,workingPolicies:[]},'exploration','workspace-101'),null);
});
