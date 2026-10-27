import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {workspaceStep,modules,validateCandidate,validateBroadcast,moduleContext,broadcastContract} from './workspace.mjs';
import {workspaceState,reconcilePredictions,workspaceEvidence} from './workspace-state.mjs';
import {socialStep} from './integrations.mjs';
import {studioOperationId} from './studio.mjs';
import {scopedSQL} from './instance.mjs';
const now=new Date('2026-10-27T12:00:00Z');
const studio={projects:[{id:'old-theme',status:'active'}]};
const candidate=(action='commission')=>({action,goalId:'new-question',projectId:'',objective:'Explore belonging through a visual joke.',why:'A new question unrelated to the old theme.',success:'A legible first experiment.',proposal:action==='write'?'A real written fragment.':'Create an original visual joke about belonging, without an inherited technical subject.',novelty:'Different cultural association and construction.',uncertainty:'Audience response is unknown.',evidence:[],prediction:{metric:action==='write'?'draft_saved':action==='commission'?'publication':'none',probability:.6},queries:[]});
const broadcast=()=>({selectedId:'exploration',attention:['exploration','self_monitor'],summary:'Choose a new question rather than repeat an inherited project.',selection:modules.map(id=>({id,reason:id==='exploration'?'Selected for its unanswered question.':'Kept as a competing possibility.'})),selfModel:{desire:'Explore belonging.',preferences:['Playful incongruity'],uncertainties:['Whether it communicates'],change:'A new interest, not a new invented biography.'},evidence:[],goalChanges:[],sources:['Colossal'],note:{claim:'A new goal can be attempted without continuing old projects.',evidence:[],links:[]}});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Test'});await s.transaction(c=>s.append(c,'studio_revision',studio));return {s,db};}
test('workspace resumes across restarts, compares independent proposals, broadcasts and executes once outside old projects',async()=>{
 const {s,db}=await fixture();let calls=0;const provider={quote:()=>10,generate:async(_s,p)=>{calls++;return {costMicrodollars:1,value:calls<=4?candidate():broadcast()}}};
 try{
  for(const name of modules){assert.equal((await workspaceStep(new PostgresStore(s.pool),provider,now)).module,name);assert.equal((await s.pool.query('SELECT * FROM agent_agenda')).rows.length,0);}
  const result=await workspaceStep(s,provider,now);assert.equal(result.status,'workspace_decided');assert.equal(result.choice,'commission');
  const task=(await s.pool.query('SELECT * FROM agent_agenda')).rows[0];assert.equal(task.project_id,'');assert.equal(task.goal_id,'new-question');
  assert.equal((await workspaceStep(s,provider,now)).replay,true);assert.equal(calls,5);
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
 const {s,db}=await fixture();let calls=0;const provider={quote:()=>1,generate:async()=>({costMicrodollars:1,value:++calls<=4?candidate():{...broadcast(),selectedId:'invented'}})};
 try{for(let i=0;i<4;i++)await workspaceStep(s,provider,now);assert.equal((await workspaceStep(s,provider,now)).status,'workspace_decision_failed');assert.equal((await s.pool.query('SELECT * FROM agent_goals')).rows.length,0);await workspaceStep(s,provider,now);assert.equal(calls,5);assert.equal((await s.status()).unresolved,0);}finally{await db.close();}
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
test('live memory-link regression: model contract permits only actual evidence IDs and bounded notes',()=>{
 const snapshot={studio,state:{goals:[],predictions:[]},evidence:[{id:'7'},{id:'room:example'}],tasks:[]};
 const candidates=modules.map(id=>({...candidate(),id}));
 const schema=broadcastContract(candidates,snapshot);
 assert.deepEqual(schema.properties.note.properties.links.items.enum,['7','room:example']);
 assert.equal(schema.properties.note.properties.links.maxItems,3);
 assert.ok(schema.properties.note.properties.claim.description.includes('400'));
 assert.throws(()=>validateBroadcast({...broadcast(),note:{claim:'A hypothesis',evidence:['7'],links:['invented-memory']}},candidates,snapshot),/INVALID/);
 assert.equal(validateBroadcast({...broadcast(),note:{claim:'A hypothesis',evidence:['7'],links:[]}},candidates,snapshot).note.evidence[0],'7');
});
test('memory sampling and broadcast ablations change available evidence, not merely an explanatory caption',async()=>{
 const {s,db}=await fixture();try{
  await s.transaction(async c=>{await s.append(c,'workspace_note',{text:'An older unresolved cultural question.',evidence:[],links:[]});await s.append(c,'observation',{news:[{source:'Culture',title:'An unfamiliar visual ritual',url:'https://example.org/ritual'}]});await s.append(c,'workspace_broadcast',{selfModel:{desire:'A persistent interest'},attention:['exploration']});});
  const evidence=await workspaceEvidence(s,1),state=await workspaceState(s);const snapshot={studio,state,evidence,tasks:[]};
  const memory=moduleContext('recall',snapshot),exploration=moduleContext('exploration',snapshot);
  assert.ok(memory.evidence.some(e=>e.kind==='workspace_note'));assert.ok(exploration.evidence.some(e=>e.kind==='headline'));assert.ok(!memory.evidence.some(e=>e.kind==='headline'));
  const withoutMemory=moduleContext('recall',{...snapshot,evidence:[]});assert.equal(withoutMemory.evidence.length,0);
  const withoutBroadcast=moduleContext('exploration',{...snapshot,state:{...state,broadcast:null}});assert.equal(withoutBroadcast.previousBroadcast,null);assert.ok(exploration.previousBroadcast);
 }finally{await db.close();}
});
