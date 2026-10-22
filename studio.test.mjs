import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {studioStep,validateStudio,validateStudioChoice} from './studio.mjs';
import {socialStep} from './integrations.mjs';
const snapshot=()=>({voice:'Curious and spare',visualDirection:'Ink experiments',interests:[{topic:'Edges',why:'My earlier image left a boundary unresolved.',question:'When does a boundary become a shape?'}],criteria:['Each work tests a distinct transformation.'],tensions:['Precision versus ambiguity'],projects:[{id:'moving-edge',title:'Moving edge',status:'active',question:'Can a line become a place?',intent:'Explore one line across several works.',nextStep:'Write the first transformation.',assessment:'New project; no outcome yet.',evidence:[]}],summary:'Starting an independent series from an unresolved visual question.'});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Artist',voice:'Old voice'});return {s,db};}

test('studio persists across restarts, reaches the original-post planner and links a real publication',async()=>{
 const {s,db}=await fixture();const now=new Date('2026-10-22T20:00:00Z');let calls=0,posts=0;
 const provider={quote:()=>100,generate:async(system,prompt)=>{calls++;if(calls===1)return {costMicrodollars:50,value:snapshot()};assert.match(prompt,/moving-edge/);assert.match(prompt,/News is optional/);return {costMicrodollars:50,value:{action:'x_draft',intent:'project',projectId:'moving-edge',medium:'text',text:'A line folds until it remembers a room.',summary:'First transformation in my own series.'}}}};
 const x={verify:async()=>({}),post:async(text,reply)=>{assert.equal(reply,null);posts++;return {id:'123',url:'https://x.com/i/web/status/123'}}};
 const env={X_ENABLED:'true',X_REPLIES_ENABLED:'false'};
 try{
 assert.equal((await socialStep(s,provider,env,now,()=>x)).status,'studio_revised');
 const restarted=new PostgresStore(s.pool);assert.equal((await restarted.latest('studio_revision')).projects[0].id,'moving-edge');
 await socialStep(restarted,provider,env,now,()=>x);await socialStep(restarted,provider,env,now,()=>x);await socialStep(restarted,provider,env,now,()=>x);
 assert.equal(posts,1);assert.equal(calls,2);assert.equal((await restarted.latest('x_post')).projectId,'moving-edge');
 assert.equal((await restarted.publicRuntime()).studio.voice,'Curious and spare');assert.ok((await restarted.publicJournal()).some(e=>e.kind==='studio_revision'));
 assert.equal((await studioStep(restarted,provider,now)).status,'studio_already_attempted');assert.equal(calls,2);
 }finally{await db.close()}
});

test('projects cannot disappear silently, cite invented evidence or claim completion from a draft plan',()=>{
 const old=validateStudio(snapshot(),null,[]);
 const dropped=snapshot();dropped.projects[0].id='other-project';assert.throws(()=>validateStudio(dropped,old,[]),/INVALID/);
 const fake=snapshot();fake.projects[0].evidence=['999'];assert.throws(()=>validateStudio(fake,old,[]),/INVALID/);
 const done=snapshot();done.projects[0].status='completed';done.projects[0].evidence=['1'];assert.throws(()=>validateStudio(done,old,[{seq:'1',kind:'x_draft',payload:{projectId:'moving-edge'}}]),/INVALID/);
 assert.equal(validateStudio(done,old,[{seq:'1',kind:'x_post',payload:{projectId:'moving-edge'}}]).projects[0].status,'completed');
 assert.throws(()=>validateStudioChoice({action:'x_draft',intent:'project',projectId:'invented'},old),/PROJECT_NOT_ACTIVE/);
 assert.throws(()=>validateStudioChoice({action:'x_draft',intent:'project'},old),/PROJECT_REQUIRED/);
});

test('invalid paid revision preserves prior state, settles actual cost and never retries in same window',async()=>{
 const {s,db}=await fixture();let calls=0;const good={quote:()=>100,generate:async()=>({costMicrodollars:30,value:snapshot()})};
 try{await studioStep(s,good,new Date('2026-10-22T00:00:00Z'));const bad={quote:()=>100,generate:async()=>{calls++;return {costMicrodollars:40,value:{voice:'incomplete'}}}};
 await studioStep(s,bad,new Date('2026-10-22T06:00:00Z'));await studioStep(s,bad,new Date('2026-10-22T06:30:00Z'));
 assert.equal(calls,1);assert.equal((await s.latest('studio_revision')).voice,'Curious and spare');assert.equal((await s.status()).unresolved,0);assert.equal((await s.status()).todayMicrodollars,71);
 }finally{await db.close()}
});
