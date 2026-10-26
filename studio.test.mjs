import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {studioStep,validateStudio,validateStudioChoice,studioSchema} from './studio.mjs';
import {socialStep,setupAppearance} from './integrations.mjs';
const snapshot=()=>({persona:{selfDescription:'I collect awkward shapes.',desire:'Make an unlikely shape feel familiar.',temperament:'Playful but stubborn about edges.',relationshipToAudience:'Invite disagreement about the work.',voiceExamples:['This edge refuses to behave.','I made it too smooth.','What would you remove?'],embodiment:{description:'A folded paper creature with an expressive face.',recognitionAnchors:'Folded cheek and uneven eyes.',portraitPrompt:'Square paper creature portrait with uneven eyes.'},growthNote:'A first provisional self-description.'},voice:'Curious and spare',visualDirection:'Ink experiments',interests:[{topic:'Edges',why:'My earlier image left a boundary unresolved.',question:'When does a boundary become a shape?'}],criteria:['Each work tests a distinct transformation.'],tensions:['Precision versus ambiguity'],projects:[{id:'moving-edge',title:'Moving edge',status:'active',question:'Can a line become a place?',intent:'Explore one line across several works.',nextStep:'Write the first transformation.',assessment:'New project; no outcome yet.',evidence:[]}],summary:'Starting an independent series from an unresolved visual question.'});
test('legacy schema failure gets exactly one bounded repair attempt with a provider schema',async()=>{
 const {s,db}=await fixture();const now=new Date('2026-10-22T20:00:00Z');let calls=0;
 try{const id='studio-'+Math.floor(now.getTime()/21600000)+'-persona-v1';await s.begin(id,'step',()=>({maximum:10}));await s.complete(id,10,{action:'studio_failed'});
 const provider={quote:()=>100,generate:async(_system,_prompt,media,schema)=>{calls++;assert.equal(media,null);assert.deepEqual(schema,studioSchema);return {costMicrodollars:20,value:snapshot()}}};
 assert.equal((await studioStep(s,provider,now)).status,'studio_revised');assert.equal((await studioStep(s,provider,now)).status,'studio_already_attempted');assert.equal(calls,1);
 }finally{await db.close()}
});
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Artist',voice:'Old voice'});return {s,db};}

test('studio persists across restarts, reaches the original-post planner and links a real publication',async()=>{
 const {s,db}=await fixture();const now=new Date('2026-10-22T20:00:00Z');let calls=0,posts=0;
 const provider={quote:()=>100,generate:async(system,prompt)=>{calls++;if(calls===1)return {costMicrodollars:50,value:snapshot()};assert.match(prompt,/moving-edge/);assert.match(prompt,/folded paper creature/i);assert.match(prompt,/News is optional/);return {costMicrodollars:50,value:{action:'x_draft',intent:'project',projectId:'moving-edge',medium:'text',text:'A line folds until it remembers a room.',summary:'First transformation in my own series.'}}}};
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


test('persona is allowlisted, reaches planning and self-portrait renders once across revisions',async()=>{
 const {s,db}=await fixture();let renders=0;
 try{
 const raw=snapshot();raw.persona.privateNote='must not persist';raw.persona.embodiment.extra='must not persist';
 const clean=validateStudio(raw,null,[]);assert.equal(clean.persona.privateNote,undefined);assert.equal(clean.persona.embodiment.extra,undefined);
 await s.begin('persona-fixture','step',()=>({maximum:0}));await s.complete('persona-fixture',0,clean);
 const image=()=>({quote:()=>100,generate:async prompt=>{renders++;assert.match(prompt,/uneven eyes/);return {bytes:Buffer.from('fixture'),mime:'image/png',costMicrodollars:10}}});
 assert.equal((await setupAppearance(s,null,{},image)).status,'complete');
 const changed=snapshot();changed.persona.embodiment.portraitPrompt='A different portrait proposal';
 await s.begin('persona-later','step',()=>({maximum:0}));await s.complete('persona-later',0,validateStudio(changed,clean,[]));
 assert.equal((await setupAppearance(s,null,{},image)).status,'complete');assert.equal(renders,1);
 assert.equal((await s.publicRuntime()).appearance.assetId,'persona-appearance-v1');assert.ok(await s.asset('persona-appearance-v1'));
 const bad=snapshot();bad.persona.voiceExamples=[];assert.throws(()=>validateStudio(bad,null,[]),/INVALID/);
 }finally{await db.close()}
});

test('failed portrait preserves the previous image and does not automatically spend again',async()=>{
 const {s,db}=await fixture();let calls=0;
 try{
 await s.begin('old-portrait','step',()=>({maximum:0}));await s.complete('old-portrait',0,{action:'appearance_image',assetId:'old-portrait',text:'old'},{bytes:Buffer.from('old'),mime:'image/png'});
 await s.begin('persona-fixture','step',()=>({maximum:0}));await s.complete('persona-fixture',0,validateStudio(snapshot(),null,[]));
 const image=()=>({quote:()=>100,generate:async()=>{calls++;throw Error('provider unavailable')}});
 assert.equal((await setupAppearance(s,null,{},image)).status,'failed');assert.equal((await setupAppearance(s,null,{},image)).status,'failed');
 assert.equal(calls,1);assert.equal((await s.publicRuntime()).appearance.assetId,'old-portrait');assert.equal((await s.status()).unresolved,0);
 }finally{await db.close()}
});
