import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {PostgresStore} from './postgres.mjs';
import {oauthRoute,oauthAccess,seal,unseal,CALLBACK} from './oauth.mjs';
const env={VERCEL_ENV:'production',X_CLIENT_ID:'client',X_CLIENT_SECRET:'secret',AGENT_ADMIN_SECRET:'a'.repeat(40),X_EXPECTED_USERNAME:'alidade_art'};
const scopes='tweet.read tweet.write users.read media.write offline.access';
test('encrypted OAuth flow: owner only, browser binding, one-time callback, account pinning, refresh and fail-closed recovery',async()=>{
 const db=new PGlite();await db.exec(await readFile(new URL('./schema.sql',import.meta.url),'utf8'));
 const client={query:async(sql,args)=>{const r=await db.query(sql,args);return {...r,rowCount:r.affectedRows||r.rows.length}},release(){}};
 const store=new PostgresStore({query:client.query,connect:async()=>client});
 try{
 const start=auth=>new Request(CALLBACK,{method:'POST',headers:{origin:new URL(CALLBACK).origin,authorization:auth}});
 assert.equal((await oauthRoute(start('bad'),store,env)).status,401);
 async function session(){const r=await oauthRoute(start('Bearer '+env.AGENT_ADMIN_SECRET),store,env);const url=new URL((await r.json()).url);assert.equal(url.searchParams.get('code_challenge_method'),'S256');return {state:url.searchParams.get('state'),cookie:r.headers.get('set-cookie').split(';')[0]};}
 const s=await session();const callback=c=>new Request(CALLBACK+'?state='+s.state+'&code=private-code',{headers:{cookie:c}});
 let calls=0;const provider=async(url)=>{calls++;return Response.json(url.endsWith('/token')?{access_token:'access',refresh_token:'refresh',expires_in:7200,scope:scopes,token_type:'bearer'}:{data:{id:'123',username:'alidade_art'}})};
 assert.equal((await oauthRoute(callback('wrong=bad'),store,env,provider)).status,400);assert.equal(calls,0);
 const r=await oauthRoute(callback(s.cookie),store,env,provider);assert.match(r.headers.get('location'),/connected/);assert.equal(calls,2);
 assert.equal((await oauthRoute(callback(s.cookie),store,env,provider)).status,400);assert.equal(calls,2);
 const row=(await db.query('SELECT * FROM agent_oauth_tokens')).rows[0];assert.ok(!row.secret.includes('refresh'));assert.equal(unseal(row.secret,env.AGENT_ADMIN_SECRET).access,'access');assert.throws(()=>unseal(row.secret,'wrong'));
 assert.equal(await oauthAccess(store,env,provider),'access');assert.equal(calls,2);
 await store.pool.query('UPDATE agent_oauth_tokens SET secret=$1',[seal({access:'old',refresh:'refresh',expires:Date.now()+7200000},env.AGENT_ADMIN_SECRET)]);
 assert.equal(await oauthAccess(store,env,provider,'old'),'access');assert.equal(calls,3);
 assert.equal(await oauthAccess(store,env,provider,'old'),'access');assert.equal(calls,3);
 await store.pool.query('UPDATE agent_oauth_tokens SET secret=$1',[seal({access:'old',refresh:'refresh',expires:0},env.AGENT_ADMIN_SECRET)]);
 await assert.rejects(oauthAccess(store,env,async()=>{throw Error('timeout')}),/RECONNECT_REQUIRED/);
 await assert.rejects(oauthAccess(store,env,provider),/NOT_CONNECTED/);assert.equal(calls,3);
 const mismatch=await session();const wrong=await oauthRoute(new Request(CALLBACK+'?state='+mismatch.state+'&code=c',{headers:{cookie:mismatch.cookie}}),store,env,async url=>url.endsWith('/token')?provider(url):Response.json({data:{id:'456',username:'wrong_account'}}));assert.match(wrong.headers.get('location'),/failed/);
 assert.equal((await db.query('SELECT status FROM agent_oauth_tokens')).rows[0].status,'reconnect_required');
 const pending=await session();
 const disconnect=(auth='Bearer '+env.AGENT_ADMIN_SECRET,origin=new URL(CALLBACK).origin)=>new Request(CALLBACK+'?action=disconnect',{method:'POST',headers:{authorization:auth,origin}});
 assert.equal((await oauthRoute(disconnect('bad'),store,env)).status,401);
 assert.equal((await oauthRoute(disconnect(undefined,'https://wrong.example'),store,env)).status,403);
 assert.equal((await oauthRoute(disconnect(),store,env)).status,200);
 await assert.rejects(oauthAccess(store,env,provider),/NOT_CONNECTED/);
 assert.equal((await oauthRoute(new Request(CALLBACK+'?state='+pending.state+'&code=c',{headers:{cookie:pending.cookie}}),store,env,provider)).status,400);
 const fresh=await session();
 const linked=await oauthRoute(new Request(CALLBACK+'?state='+fresh.state+'&code=c',{headers:{cookie:fresh.cookie}}),store,env,provider);assert.match(linked.headers.get('location'),/connected/);
 const racing=await session();
 const raced=await oauthRoute(new Request(CALLBACK+'?state='+racing.state+'&code=c',{headers:{cookie:racing.cookie}}),store,env,async url=>{if(url.endsWith('/token'))await oauthRoute(disconnect(),store,env);return provider(url)});
 assert.match(raced.headers.get('location'),/failed/);
 await assert.rejects(oauthAccess(store,env,provider),/NOT_CONNECTED/);
 }finally{await db.close()}
});
