import {createHash, randomBytes, createCipheriv, createDecipheriv} from 'node:crypto';
import {ACTIVE_INSTANCE} from './instance.mjs';
import {authorized} from './cloud.mjs';

export const CALLBACK='https://agent-performance-mrshapeless.vercel.app/api/x-auth';
const SCOPES='tweet.read tweet.write users.read media.write offline.access';
const hash=s=>createHash('sha256').update(s).digest('hex');
const cookie='__Host-x-oauth';
export function seal(value,secret){
  if(!secret||secret.length<32)throw Error('X_ENCRYPTION_NOT_CONFIGURED');
  const key=createHash('sha256').update(secret+':x-oauth:'+ACTIVE_INSTANCE).digest();
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  return JSON.stringify([iv.toString('base64'),Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]).toString('base64'),cipher.getAuthTag().toString('base64')]);
}
export function unseal(value,secret){
  const [iv,data,tag]=JSON.parse(value),key=createHash('sha256').update(secret+':x-oauth:'+ACTIVE_INSTANCE).digest();
  const cipher=createDecipheriv('aes-256-gcm',key,Buffer.from(iv,'base64'));cipher.setAuthTag(Buffer.from(tag,'base64'));
  return JSON.parse(Buffer.concat([cipher.update(Buffer.from(data,'base64')),cipher.final()]));
}
async function tokenRequest(env,body,fetcher){
  const r=await fetcher('https://api.x.com/2/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Authorization:'Basic '+Buffer.from(encodeURIComponent(env.X_CLIENT_ID)+':'+encodeURIComponent(env.X_CLIENT_SECRET)).toString('base64')},body:new URLSearchParams(body),signal:AbortSignal.timeout(10000)});
  if(!r.ok)throw Error('X_AUTHORIZATION_FAILED');
  const t=await r.json();
  if(!t.access_token||!t.refresh_token||!Number.isFinite(t.expires_in)||t.expires_in<=0||t.token_type?.toLowerCase()!=='bearer'||!SCOPES.split(' ').every(s=>t.scope?.split(' ').includes(s)))throw Error('X_TOKEN_INVALID');
  return {access:t.access_token,refresh:t.refresh_token,expires:Date.now()+t.expires_in*1000};
}
export async function oauthStatus(store){
  const row=(await store.pool.query('SELECT username,status FROM agent_oauth_tokens WHERE id=1')).rows[0];
  return row??null;
}
export async function oauthAccess(store,env,fetcher=fetch,rejectedAccess=null){
  let failure=false;
  const token=await store.transaction(async c=>{
    const row=(await c.query('SELECT * FROM agent_oauth_tokens WHERE id=1 FOR UPDATE')).rows[0];
    if(!row||row.status!=='connected'||row.username!==env.X_EXPECTED_USERNAME?.replace(/^@/,'').toLowerCase())throw Error('X_NOT_CONNECTED');
    let t=unseal(row.secret,env.AGENT_ADMIN_SECRET);
    if(t.expires>Date.now()+60000 && t.access!==rejectedAccess)return t.access;
    // Commit a reconnect requirement after any ambiguous rotation. Never replay an old refresh token.
    try{t=await tokenRequest(env,{grant_type:'refresh_token',refresh_token:t.refresh},fetcher);await c.query('UPDATE agent_oauth_tokens SET secret=$1 WHERE id=1',[seal(t,env.AGENT_ADMIN_SECRET)]);return t.access;}
    catch{await c.query("UPDATE agent_oauth_tokens SET status='reconnect_required' WHERE id=1");failure=true;}
  });
  if(failure)throw Error('X_RECONNECT_REQUIRED');return token;
}
export async function oauthRoute(request,store,env,fetcher=fetch){
  const url=new URL(request.url),headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff'};
  const json=(body,status=200)=>Response.json(body,{status,headers});
  if(env.VERCEL_ENV!=='production')return json({error:'PRODUCTION_ONLY'},403);
  if(!env.X_CLIENT_ID||!env.X_CLIENT_SECRET||!env.AGENT_ADMIN_SECRET||!env.X_EXPECTED_USERNAME)return json({error:'X_OAUTH_CONFIG_REQUIRED'},409);
  if(request.method==='POST'){
    if(!authorized(request.headers.get('authorization'),env.AGENT_ADMIN_SECRET))return json({error:'UNAUTHORIZED'},401);
    if(request.headers.get('origin')!==new URL(CALLBACK).origin)return json({error:'INVALID_ORIGIN'},403);
    const state=randomBytes(32).toString('base64url'),browser=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
    await store.pool.query('DELETE FROM agent_oauth_states WHERE expires < now()');
    await store.pool.query("INSERT INTO agent_oauth_states(state,browser,secret,expires) VALUES($1,$2,$3,now()+interval '10 minutes')",[hash(state),hash(browser),seal({verifier,expected:env.X_EXPECTED_USERNAME.replace(/^@/,'').toLowerCase()},env.AGENT_ADMIN_SECRET)]);
    const target=new URL('https://x.com/i/oauth2/authorize');target.search=new URLSearchParams({response_type:'code',client_id:env.X_CLIENT_ID,redirect_uri:CALLBACK,scope:SCOPES,state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    return Response.json({url:target.href},{headers:{...headers,'Set-Cookie':`${cookie}=${browser}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`}});
  }
  if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
  const state=url.searchParams.get('state'),browser=request.headers.get('cookie')?.split('; ').find(x=>x.startsWith(cookie+'='))?.slice(cookie.length+1);
  if(!state||!browser)return json({error:'INVALID_OAUTH_SESSION'},400);
  const row=(await store.pool.query('DELETE FROM agent_oauth_states WHERE state=$1 AND browser=$2 AND expires>now() RETURNING secret',[hash(state),hash(browser)])).rows[0];
  if(!row)return json({error:'EXPIRED_OR_USED_OAUTH_SESSION'},400);
  headers['Set-Cookie']=`${cookie}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  let result='failed';
  try{
    const s=unseal(row.secret,env.AGENT_ADMIN_SECRET);
    if(!url.searchParams.get('code')||url.searchParams.has('error'))throw Error('DENIED');
    const t=await tokenRequest(env,{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:CALLBACK,code_verifier:s.verifier},fetcher);
    const r=await fetcher('https://api.x.com/2/users/me',{headers:{Authorization:'Bearer '+t.access},signal:AbortSignal.timeout(10000)});
    if(!r.ok)throw Error('VERIFY_FAILED');const account=(await r.json()).data;
    if(!account?.id||account.username?.toLowerCase()!==s.expected||s.expected!==env.X_EXPECTED_USERNAME.replace(/^@/,'').toLowerCase())throw Error('ACCOUNT_MISMATCH');
    await store.transaction(async c=>{
      await c.query("INSERT INTO agent_oauth_tokens(id,username,secret,status) VALUES(1,$1,$2,'connected') ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,secret=EXCLUDED.secret,status='connected'",[s.expected,seal(t,env.AGENT_ADMIN_SECRET)]);
      await store.append(c,'account_connection',{action:'account_connection',status:'verified',username:s.expected,text:`X account @${account.username} connected using OAuth 2.0.`,summary:'Owner authorized access. Publishing requires X_ENABLED=true.'});
    });result='connected';
  }catch{/* Never expose provider payloads, codes or tokens. */}
  return new Response(null,{status:303,headers:{...headers,Location:'/admin?x_auth='+result}});
}
