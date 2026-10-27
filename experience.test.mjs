import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {observe,audienceStep,webInbox,parseFeed,feedback,feeds} from './experience.mjs';
const env={VERCEL_ENV:'production',AGENT_ENABLED:'true',AGENT_ADMIN_SECRET:'a'.repeat(40),X_ENABLED:'true',X_REPLIES_ENABLED:'true',X_EXPECTED_USERNAME:'artist'};
async function fixture(fn){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const s=new PostgresStore({query:c.query,connect:async()=>c});await s.begin('birth','birth',()=>({maximum:1}));await s.complete('birth',1,{name:'self chosen'});try{await fn(s)}finally{await db.close()}}
const feed='<rss><channel><item><title>New observation</title><link>https://example.com/story</link><pubDate>'+new Date().toUTCString()+'</pubDate></item></channel></rss>';
test('observations retain sources, zero exposure is not failure, mentions deduplicate and stop opts out',()=>fixture(async s=>{
 let read=0;const client=()=>({verify:async()=>({id:'1'}),request:async()=>{read++;return {data:[{id:'2',author_id:'8',text:'@artist What changed?'},{id:'3',author_id:'9',text:'@artist stop'}],meta:{newest_id:'3'}}}});
 const r=await observe(s,env,new Date(),async()=>new Response(feed),client);assert.equal(r.news,feeds.length);assert.equal(r.mentions,1);
 const again=await observe(s,env,new Date(),async()=>new Response(feed),client);assert.equal(again.replay,true);assert.equal(read,1);
 assert.equal((await s.pool.query('SELECT * FROM agent_optouts')).rows.length,1);
 assert.equal((await s.latest('observation')).news[0].url,'https://example.com/story');
 assert.equal(feedback([{id:'1',public_metrics:{impression_count:2,like_count:0}}])[0].score,null);
 assert.equal(parseFeed(feed.replace('https://example.com/story','javascript:alert(1)'),'test').length,0);
}));
test('web consent and origin gates, private receipt, rate limit, one durable response',()=>fixture(async s=>{
 const req=(origin,consent=true)=>new Request('https://agent-performance-mrshapeless.vercel.app/api/inbox',{method:'POST',headers:{origin,'x-forwarded-for':'127.0.0.1'},body:JSON.stringify({text:'Why do you repeat numbered lists?',consent})});
 assert.equal((await webInbox(req('https://other.example'),s,env)).status,403);
 assert.equal((await webInbox(req('https://agent-performance-mrshapeless.vercel.app',false),s,env)).status,400);
 const accepted=await webInbox(req('https://agent-performance-mrshapeless.vercel.app'),s,env),body=await accepted.json();assert.equal(accepted.status,202);
 let calls=0;const provider={quote:()=>100,generate:async(system,prompt)=>{calls++;assert.match(prompt,/Why do you repeat/);return {costMicrodollars:10,value:{action:'reply',text:'I can change the form when the question demands it.',summary:'Addressed the actual criticism.',genuine:true}}}};
 assert.equal((await audienceStep(s,provider,env)).status,'web_replied');assert.equal((await audienceStep(s,provider,env)).status,'no_messages');assert.equal(calls,1);
 const receipt=await webInbox(new Request('https://agent-performance-mrshapeless.vercel.app/api/inbox?id='+body.id),s,env);assert.equal((await receipt.json()).status,'replied');
 for(let i=0;i<4;i++)await webInbox(req('https://agent-performance-mrshapeless.vercel.app'),s,env);
 assert.equal((await webInbox(req('https://agent-performance-mrshapeless.vercel.app'),s,env)).status,429);
}));
test('X responds to exact opted-in interaction once and respects the publishing switch',()=>fixture(async s=>{
 await s.pool.query("INSERT INTO agent_inbox(id,platform,author,text,metadata) VALUES('x-123','x','x:8','@artist Why?', $1)",[JSON.stringify({postId:'123',authorId:'8'})]);
 let writes=0;const client=()=>({request:async()=>({data:{author_id:'8'}}),post:async(text,id)=>{assert.equal(id,'123');writes++;return {id:'456',url:'https://x.com/i/web/status/456'}}});
 const provider={quote:()=>10,generate:async()=>({costMicrodollars:1,value:{action:'reply',text:'I have a reason worth discussing.',summary:'Responding directly.',genuine:true}})};
 assert.equal((await audienceStep(s,provider,{...env,X_ENABLED:'false'},new Date(),client)).status,'no_messages');assert.equal(writes,0);assert.equal((await audienceStep(s,provider,{...env,X_REPLIES_ENABLED:undefined},new Date(),client)).status,'no_messages');assert.equal(writes,0);
 assert.equal((await audienceStep(s,provider,env,new Date(),client)).status,'x_replied');await audienceStep(s,provider,env,new Date(),client);assert.equal(writes,1);
 assert.equal((await s.latest('x_reply')).postId,'456');
}));

test('a failed mention read does not erase independent post metrics',()=>fixture(async s=>{
 await s.transaction(c=>s.append(c,'x_post',{postId:'456',text:'A published work'}));
 const client=()=>({verify:async()=>({id:'1'}),request:async(method,path)=>{if(path.includes('/mentions'))throw Error('X_HTTP_401');return {data:[{id:'456',text:'A published work',public_metrics:{impression_count:70,like_count:2,reply_count:1}}]}}});
 const r=await observe(s,env,new Date(),async()=>new Response(feed),client);
 assert.equal(r.metrics,1);assert.deepEqual(r.errors,['X mentions: X_HTTP_401']);assert.ok((await s.latest('observation')).metrics[0].score>0);
}));
