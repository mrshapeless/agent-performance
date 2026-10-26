import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {workStep,publicWorks,validateWork,validateAssembly,validateAudience} from './works.mjs';
import {createHandler} from './cloud.mjs';
const studio={projects:[{id:'chairs',status:'active'}],interests:[{topic:'chairs'}]};
const audience={alternatives:[0,1,2].map(i=>({id:'idea-'+i,premise:'A distinct seat story '+i,firstLook:'A chair wearing a seatbelt.',reasonToContinue:'The passenger changes.',payoff:'The driver is another chair.',format:'Visual sequence'})),selectedId:'idea-1',selectionReason:'The second idea has a visible reversal.'};
const plan={audience,title:'Three seats',format:'Illustrated story',projectId:'chairs',intent:'Discover what a chair remembers.',visualContinuity:'Three different blue chairs.',summary:'An original story.',sections:Array.from({length:3},(_,i)=>({heading:'Seat '+i,text:'A first draft about a particular forgotten seat.',prompt:'PRIVATE_PROMPT original chair scene '+i,alt:'An illustrated chair.'}))};
async function fixture(){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Test'});await s.transaction(c=>s.append(c,'studio_revision',studio));return {s,db};}
test('multi-part work resumes each phase, inspects actual images, revises prose and never regenerates completed work',async()=>{
 const {s,db}=await fixture();let images=0,calls=0,actual=0;
 const provider={quote:()=>1,generate:async(_s,p,media,schema,refs)=>{calls++;if(schema.properties.intent)return {value:plan,costMicrodollars:1};if(schema.properties.observation){assert.equal(Buffer.from(media.bytes).toString(),'synthetic-image');actual++;return {value:{observation:'The chair is blue.',relationToText:'The text needs revision.',continuity:'Blue continues.',nextLesson:'Vary the viewpoint.'},costMicrodollars:1}}assert.equal(refs.length,3);return {value:{title:'Three seats revised',introduction:'This is the revised introduction.',conclusion:'This is the revised conclusion.',summary:'Revised after seeing actual blue chairs.',sections:plan.sections.map(s=>({heading:s.heading,text:'The actual chair is blue. This revision develops the narrative through the images, rather than repeating the original caption.'}))},costMicrodollars:1}}};
 const services={imageQuote:()=>1,image:async()=>{images++;return {bytes:Buffer.from('synthetic-image'),mime:'image/png',costMicrodollars:1}}};
 try{await workStep(s,provider,{},services);await s.pool.query("UPDATE agent_works SET updated='2026-10-26 19:00:00.123456+00'");for(let i=0;i<7;i++)assert.notEqual((await workStep(new PostgresStore(s.pool),provider,{},services)).status,'failed');const w=(await publicWorks(s,'first-independent-work-v1'))[0];assert.equal(w.status,'published');assert.equal(images,3);assert.equal(actual,3);assert.equal(calls,5);assert.match(w.sections[0].text,/actual chair/);assert.doesNotMatch(JSON.stringify(w),/PRIVATE_PROMPT/);await workStep(s,provider,{},services);assert.equal(images,3);assert.equal(calls,5);assert.equal((await s.status()).unresolved,0);
 }finally{await db.close()}
});
test('failed render preserves outline, releases reservation and is not retried silently',async()=>{const {s,db}=await fixture();const provider={quote:()=>1,generate:async()=>({value:plan,costMicrodollars:1})};let calls=0;const services={imageQuote:()=>1,image:async()=>{calls++;throw Error('secret-provider-response')}};try{await workStep(s,provider,{},services);assert.equal((await workStep(s,provider,{},services)).status,'failed');await workStep(s,provider,{},services);assert.equal(calls,1);assert.equal((await s.status()).unresolved,0);assert.doesNotMatch(JSON.stringify(await publicWorks(s,'first-independent-work-v1')),/secret-provider-response/);}finally{await db.close()}});
test('project execution needs cron authorization; public works are read-only',async()=>{let opens=0;const h=createHandler({env:{},openStore:()=>{opens++;throw Error('Unexpected')}});assert.equal((await h(new Request('https://test/api/project?view=public'))).status,401);assert.equal((await h(new Request('https://test/api/works',{method:'POST'}))).status,405);assert.equal(opens,0);assert.throws(()=>validateWork({...plan,sections:plan.sections.slice(0,2)},studio));});

test('an agent work request is consumed once and preserves its selected active project',async()=>{
 const {s,db}=await fixture();let calls=0;const provider={quote:()=>1,generate:async(_s,p)=>{calls++;assert.match(p,/Continue your self-selected saved intention/);assert.match(p,/chairs/);return {value:plan,costMicrodollars:1}}};
 try{await s.transaction(c=>s.append(c,'work_request',{workId:'work-chairs-test',projectId:'chairs',text:'Develop a story through three different seats.'}));assert.equal((await workStep(s,provider,{})).workId,'work-chairs-test');assert.equal(calls,1);assert.equal((await publicWorks(s,'work-chairs-test'))[0].projectId,'chairs');}finally{await db.close()}
});


test('new visual narratives allow silent panels; legacy contracts remain unchanged',()=>{
 const silent={...plan,sections:plan.sections.map(s=>({...s,text:''}))};
 const saved=validateWork(silent,studio,2);assert.equal(saved.version,2);assert.equal(saved.sections[0].text,'');
 const final={title:'The silent seat',introduction:'',conclusion:'',summary:'Images carry the story.',sections:plan.sections.map(s=>({heading:s.heading,text:''}))};
 assert.equal(validateAssembly(final,saved).introduction,'');assert.throws(()=>validateWork(silent,studio));assert.throws(()=>validateAssembly(final,plan));
 assert.throws(()=>validateAudience({...audience,selectedId:'invented'}));
 assert.throws(()=>validateAudience({...audience,alternatives:[audience.alternatives[0],audience.alternatives[0],audience.alternatives[0]]}));
});

test('an in-flight legacy work completes after the upgrade without regeneration or new required fields',async()=>{
 const {s,db}=await fixture();let calls=0;const legacy={...plan};delete legacy.audience;
 const final={title:'A legacy ending',introduction:'The introduction already belongs to this existing work.',conclusion:'The conclusion completes the existing saved intention.',summary:'Completed the saved legacy sequence.',sections:plan.sections.map(s=>({heading:s.heading,text:'This preserved text completes the earlier narrative without imposing a new format or starting any image generation again.'}))};
 try{for(const id of ['saved-a','saved-b','saved-c'])await s.pool.query("INSERT INTO agent_assets(id,mime,bytes) VALUES($1,'image/png',$2)",[id,Buffer.from('saved-image')]);await s.pool.query("INSERT INTO agent_works(id,phase,plan,data) VALUES('old-work','assemble',$1,$2)",[JSON.stringify(legacy),JSON.stringify({assets:['saved-a','saved-b','saved-c'],reviews:[{},{},{}],history:[]})]);const provider={quote:()=>1,generate:async(_s,p,_m,_schema,refs)=>{calls++;assert.equal(refs.length,3);assert.doesNotMatch(p,/AUDIENCE DIRECTION/);return {value:final,costMicrodollars:1}}};assert.equal((await workStep(s,provider,{})).status,'published');assert.equal(calls,1);assert.equal((await publicWorks(s,'old-work'))[0].title,final.title);}finally{await db.close()}
});
