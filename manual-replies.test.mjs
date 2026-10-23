import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {createHandler} from './cloud.mjs';
import {manualReplyHandler,manualDraftStep,syncReplyThreads,replyIntent} from './manual-replies.mjs';
import {scopedSQL} from './instance.mjs';
const origin='https://agent-performance-mrshapeless.vercel.app';
const env={X_ENABLED:'true',X_REPLIES_ENABLED:'false',X_EXPECTED_USERNAME:'artist',VERCEL_ENV:'production',AGENT_ENABLED:'true',AGENT_ADMIN_SECRET:'a'.repeat(40)};
async function fixture(fn){const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));const c={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};const store=new PostgresStore({query:c.query,connect:async()=>c});await store.begin('birth','birth',()=>({maximum:1}));await store.complete('birth',1,{name:'Test artist'});try{await fn(store)}finally{await db.close()}}
const req=(body)=>new Request(origin+'/api/manual-replies',{method:'POST',headers:{origin,'idempotency-key':'manual-test'},body:JSON.stringify(body)});
async function message(s){await s.pool.query("INSERT INTO agent_inbox(id,platform,author,text,metadata) VALUES('x-123','x','x:7','Why so clean?',$1)",[JSON.stringify({postId:'123',authorId:'7',rootText:'A new artwork'})]);}
test('manual queue never accepts public-view or cron credentials, and scopes new tables',async()=>{
 const handler=createHandler({env,openStore:()=>assert.fail('unauthorized must not open DB'),createProvider:()=>assert.fail()});
 for(const suffix of ['', '?view=public'])assert.equal((await handler(new Request(origin+'/api/manual-replies'+suffix))).status,401);
 assert.match(scopedSQL('SELECT * FROM agent_manual_replies JOIN agent_reply_sync ON true'),/"generation_02".agent_manual_replies JOIN "generation_02".agent_reply_sync/);
});
test('private draft uses context, survives repeats, editing has version checks and opening does not send',()=>fixture(async s=>{
 await message(s);let calls=0;
 const provider={quote:()=>100,generate:async(_,prompt)=>{calls++;assert.match(prompt,/A new artwork/);return {costMicrodollars:10,value:{action:'draft',text:'That polish keeps sneaking back in. I am testing a rougher direction.',reason:'Address the critique.'}}}};
 assert.equal((await manualDraftStep(s,provider,env)).status,'draft');assert.equal((await manualDraftStep(s,provider,env)).status,'no_manual_drafts');assert.equal(calls,1);
 assert.ok(!(await s.publicJournal()).some(e=>e.kind==='manual_reply_draft'));
 let list=await (await manualReplyHandler(new Request(origin+'/api/manual-replies'),s,null,env)).json();const item=list.items[0];assert.equal(item.state,'draft');
 const body={id:'x-123',version:item.version,action:'open',text:'A & B? 🙂'};
 const opened=await (await manualReplyHandler(req(body),s,null,env)).json();const url=new URL(opened.url);assert.equal(url.searchParams.get('in_reply_to'),'123');assert.equal(url.searchParams.get('text'),body.text);assert.equal(opened.item.state,'opened');
 assert.equal((await manualReplyHandler(req(body),s,null,env)).status,409);
 const sent=await (await manualReplyHandler(req({...body,version:opened.item.version,action:'sent'}),s,null,env)).json();assert.equal(sent.item.state,'sent');
 assert.equal((await s.pool.query("SELECT * FROM agent_operations WHERE id LIKE 'x-publish-%'")).rows.length,0);
 assert.equal((await manualReplyHandler(new Request(origin+'/api/manual-replies',{method:'POST',headers:{origin:'https://evil.test'},body:JSON.stringify(body)}),s,null,env)).status,403);
}));
test('thread scan paginates, deduplicates mentions, retains context and cannot write to X',()=>fixture(async s=>{
 await s.transaction(c=>s.append(c,'x_post',{postId:'100',text:'The original artwork'}));
 let calls=0;
 const client=()=>({verify:async()=>({id:'1'}),request:async(method,path)=>{assert.equal(method,'GET');calls++;assert.match(path,/conversation_id%3A100/);if(calls===2)assert.match(path,/next_token=page2/);return {data:[{id:'123',author_id:'7',text:'Why so clean?',conversation_id:'100',referenced_tweets:[{type:'replied_to',id:'100'}]}],includes:{users:[{id:'7',username:'viewer'}],tweets:[{id:'100',text:'The original artwork'}]},meta:calls===1?{next_token:'page2',newest_id:'123'}:{newest_id:'123'}};}});
 await message(s);assert.equal((await syncReplyThreads(s,env,new Date(),client)).status,'synced');assert.equal(calls,2);
 const rows=(await s.pool.query('SELECT * FROM agent_inbox')).rows;assert.equal(rows.length,1);assert.equal(rows[0].metadata.username,'viewer');assert.equal(rows[0].metadata.parentText,'The original artwork');
 assert.equal((await s.pool.query('SELECT * FROM agent_reply_sync')).rows[0].data.since,'123');
}));
test('opt-out prevents prepared drafts from opening and failed search access backs off',()=>fixture(async s=>{
 await message(s);await s.pool.query("INSERT INTO agent_optouts(author) VALUES('x:7')");
 assert.equal((await manualReplyHandler(req({id:'x-123',version:0,action:'open',text:'Hello'}),s,null,env)).status,409);
 await s.transaction(c=>s.append(c,'x_post',{postId:'100',text:'Original'}));let calls=0;
 const client=()=>({verify:async()=>({id:'1'}),request:async()=>{calls++;throw Error('X_HTTP_403')}});
 const now=new Date();assert.equal((await syncReplyThreads(s,env,now,client)).error,'X_HTTP_403');assert.equal((await syncReplyThreads(s,env,new Date(+now+900001),client)).status,'read_access_paused');assert.equal(calls,1);
 assert.throws(()=>replyIntent('123&foo=bar','hello'));
}));
