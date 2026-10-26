import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {PGlite} from '@electric-sql/pglite';import {readFile} from 'node:fs/promises';import {PostgresStore} from './postgres.mjs';import {roomHandler,roomContext} from './room.mjs';import {audienceStep} from './experience.mjs';import {scopedSQL} from './instance.mjs';
const origin='https://agent-performance-mrshapeless.vercel.app',env={VERCEL_ENV:'production',AGENT_ENABLED:'true',AGENT_ADMIN_SECRET:'a'.repeat(40),X_ENABLED:'true',X_REPLIES_ENABLED:'false'};
async function fixture(fn){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'Alidade'});try{await fn(s)}finally{await db.close()}}
const post=(body,headers={})=>new Request(origin+'/api/room',{method:'POST',headers:{origin,'x-forwarded-for':'127.0.0.1',...headers},body:JSON.stringify({nickname:'Visitor',text:'Hello room',consent:true,requestId:randomUUID(),...body})});
const get=(suffix='')=>new Request(origin+'/api/room'+suffix);
test('public room isolates old inbox, signs sessions, deduplicates, enforces origin/rate/names and scopes data',()=>fixture(async s=>{
 assert.match(scopedSQL('SELECT * FROM agent_room'),/"generation_02".agent_room/);
 await s.pool.query("INSERT INTO agent_inbox(id,platform,author,text) VALUES('legacy','web','private','old private message')");
 const first=await roomHandler(get(),s,env),cookie=first.headers.get('set-cookie').split(';')[0];assert.equal((await first.json()).messages.length,0);assert.match(cookie,/alidade_room=/);
 assert.equal((await roomHandler(post({}, {origin:'https://bad.example'}),s,env)).status,403);
 assert.equal((await roomHandler(post({nickname:'Alidade'}),s,env)).status,400);
 assert.equal((await roomHandler(post({consent:false}),s,env)).status,400);
 assert.equal((await roomHandler(post({}),s,{...env,VERCEL_ENV:'preview'})).status,503);
 const key=randomUUID();const one=await roomHandler(post({requestId:key},{cookie}),s,env);const body=await one.json();assert.equal(one.status,201);
 assert.equal((await (await roomHandler(post({requestId:key},{cookie}),s,env)).json()).id,body.id);
 const data=await (await roomHandler(get(),s,env)).json();assert.equal(data.messages.length,1);assert.equal(data.messages[0].response_status,null);assert.deepEqual(Object.keys(data.messages[0]).sort(),['badge','created','id','nickname','reply_to','response_status','role','seq','text'].sort());assert.ok(!JSON.stringify(data).includes('private'));
 for(let i=0;i<5;i++)assert.equal((await roomHandler(post({},{cookie}),s,env)).status,201);
 assert.equal((await roomHandler(post({},{cookie}),s,env)).status,429);
}));
test('room replies carry thread context, publish once, skip normal talk, never call X, and can be moderated',()=>fixture(async s=>{
 const cookie=(await roomHandler(get(),s,env)).headers.get('set-cookie').split(';')[0];
 const human=await (await roomHandler(post({text:'Does anyone like orange?'},{cookie}),s,env)).json();
 const asked=await (await roomHandler(post({text:'@alidade why this palette?',replyTo:human.id},{cookie}),s,env)).json();
 let calls=0;const provider={quote:()=>10,generate:async(system,prompt)=>{calls++;assert.match(prompt,/PUBLIC SHARED CHAT ROOM/);assert.match(prompt,/Does anyone like orange/);return {costMicrodollars:1,value:{action:'reply',text:'Orange interrupts the blue like a signal.',summary:'Responded to a public room question.',genuine:true}}}};
 assert.equal((await audienceStep(s,provider,env,new Date(),()=>{throw Error('X must stay off')})).status,'web_replied');assert.equal((await audienceStep(s,provider,env)).status,'no_messages');assert.equal(calls,1);
 const all=await (await roomHandler(get(),s,env)).json();const answer=all.messages.find(m=>m.role==='agent');assert.equal(answer.reply_to,asked.id);assert.equal(all.messages.length,3);
 assert.equal((await roomHandler(post({action:'hide',id:asked.id},{cookie}),s,env)).status,401);
 assert.equal((await roomHandler(post({action:'hide',id:asked.id},{cookie,authorization:'Bearer '+env.AGENT_ADMIN_SECRET}),s,env)).status,200);
 assert.equal((await (await roomHandler(get(),s,env)).json()).messages.length,1);
 assert.equal((await roomHandler(post({replyTo:asked.id},{cookie}),s,env)).status,409);
 const pending=await (await roomHandler(post({askAgent:true},{cookie}),s,env)).json();await roomHandler(post({action:'hide',id:pending.id},{authorization:'Bearer '+env.AGENT_ADMIN_SECRET}),s,env);assert.equal((await audienceStep(s,provider,env)).status,'no_messages');
}));
test('room pagination is chronological, bounded and has no skipped boundary',()=>fixture(async s=>{
 for(let i=0;i<55;i++)await s.pool.query("INSERT INTO agent_room(id,session_id,nickname,role,text) VALUES($1,'fixture','Reader','visitor',$2)",[randomUUID(),'message '+i]);
 const latest=await (await roomHandler(get(),s,env)).json();assert.equal(latest.messages.length,50);assert.equal(latest.messages[0].text,'message 5');assert.equal(latest.more,true);
 const earlier=await (await roomHandler(get('?before='+latest.before),s,env)).json();assert.equal(earlier.messages.length,5);assert.equal(earlier.messages.at(-1).text,'message 4');assert.equal(earlier.more,false);
 assert.equal((await roomHandler(get('?before=oops'),s,env)).status,400);
}));
test('provider failures are visible as unavailable, never as a fabricated answer',()=>fixture(async s=>{
 const r=await roomHandler(post({askAgent:true}),s,env);assert.equal(r.status,201);
 const provider={quote:()=>10,generate:async()=>{throw Error('provider unavailable')}};
 await audienceStep(s,provider,env);
 const d=await (await roomHandler(get(),s,env)).json();assert.equal(d.messages.length,1);assert.equal(d.messages[0].response_status,'unavailable');
 assert.equal((await audienceStep(s,provider,env)).status,'no_messages');
}));
