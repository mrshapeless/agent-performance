import {createHash} from 'node:crypto';
import {constitution} from './domain.mjs';
import {trustedMediaURL} from './media-providers.mjs';
import {profileSchema,validateProfile,trainTaste,tasteBrief,similarity} from './taste.mjs';
export async function tasteData(query){
 const profiles=(await query('SELECT asset_id,observation,traits,created FROM agent_visual_profiles ORDER BY created DESC LIMIT 200')).rows;
 const feedback=(await query('SELECT asset_id,other_id,verdict FROM agent_taste_feedback ORDER BY updated DESC LIMIT 500')).rows;
 return {profiles,feedback};
}
export async function creativeMemory(query){const d=await tasteData(query);return tasteBrief(d.profiles,d.feedback);}
export async function atelierStep(store,provider,load=loadAsset){
 const row=(await store.pool.query(`SELECT a.id,a.mime,a.bytes,a.url FROM agent_assets a
 JOIN agent_media_jobs j ON j.data->>'assetId'=a.id
 WHERE (a.mime LIKE 'image/%' OR a.mime='video/mp4')
 AND NOT EXISTS(SELECT 1 FROM agent_visual_profiles p WHERE p.asset_id=a.id)
 AND NOT EXISTS(SELECT 1 FROM agent_operations o WHERE o.id='taste-profile-'||md5(a.id))
 ORDER BY j.created DESC LIMIT 1`)).rows[0];
 if(!row)return {status:'up_to_date'};
 const id='taste-profile-'+createHash('md5').update(row.id).digest('hex');
 const prompt='Inspect only the attached actual artwork. No generation prompt or previous critique is supplied. Describe visible visual construction in <=1200 characters. Rate each trait 0 (absent) to 1 (dominant): collage (independent layers/cutouts), surfaceDamage (compression/resampling/scan artifacts, not just physical worn objects), softness (loss of fine detail), lightingMismatch (inconsistent sources between elements), spatialDistortion (incoherent scale/perspective), culturalRemix (recognizable cultural forms transformed), graphicDensity (layer and typography density), advertisingPolish (coherent glossy commercial rendering). These are neutral descriptors, not quality scores. Do not infer audience reaction. For a video inspect temporal changes as well as frames.';
 const req=await store.begin(id,'step',()=>({prompt,maximum:provider.quote(constitution,prompt)+500000}));
 if(req.replay)return {status:req.status};let cost=req.maximum;
 try{const media=await load(row);const answer=await provider.generate(constitution,prompt,media,profileSchema);cost=answer.costMicrodollars;const p=validateProfile(answer.value);
  await store.complete(id,cost,{action:'visual_profile_recorded',assetId:row.id,version:p.version},null,async c=>{await c.query('INSERT INTO agent_visual_profiles(asset_id,observation,traits) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[row.id,p.observation,JSON.stringify(p.traits)]);});
  return {status:'profiled',assetId:row.id};
 }catch{await store.complete(id,cost,{action:'visual_profile_failed',assetId:row.id});return {status:'profile_failed',assetId:row.id};}
}
async function loadAsset(a){
 if(a.bytes){if(a.bytes.length>14000000)throw Error('TOO_LARGE');return {mime:a.mime,bytes:Buffer.from(a.bytes)};}
 const r=await fetch(trustedMediaURL(a.url,true),{redirect:'error',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('ASSET_UNAVAILABLE');
 let size=0;const parts=[];for await(const chunk of r.body){size+=chunk.length;if(size>14000000)throw Error('TOO_LARGE');parts.push(Buffer.from(chunk));}return {mime:a.mime,bytes:Buffer.concat(parts)};
}
export async function atelierStatus(store){
 const d=await tasteData(store.pool.query.bind(store.pool)),model=trainTaste(d.profiles,d.feedback);
 const jobs=(await store.pool.query("SELECT id,state,plan,data FROM agent_media_jobs WHERE data ? 'assetId' ORDER BY created DESC LIMIT 30")).rows;
 const profiles=new Map(d.profiles.map(p=>[p.asset_id,p]));
 const items=jobs.map(j=>{const p=profiles.get(j.data.assetId),near=p?d.profiles.filter(x=>x.asset_id!==p.asset_id).map(x=>({assetId:x.asset_id,similarity:similarity(p,x)})).sort((a,b)=>b.similarity-a.similarity).slice(0,2):[];return {id:j.id,assetId:j.data.assetId,medium:j.plan.medium,state:j.state,caption:j.data.review?.text??j.plan.text,projectId:j.plan.projectId??null,profile:p??null,neighbors:near,feedback:d.feedback.find(f=>f.asset_id===j.data.assetId&&!f.other_id)?.verdict??null};});
 const projects=(await store.pool.query('SELECT id,phase,plan,data FROM agent_works ORDER BY updated DESC LIMIT 12')).rows.map(w=>({id:w.id,phase:w.phase,title:w.plan?.title??w.id,assets:w.data?.assets?.length??0,planned:w.plan?.sections?.length??0}));
 return {model,items,projects,profileCount:d.profiles.length,feedbackCount:d.feedback.length};
}
export async function atelierHandler(request,store,provider){
 const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Robots-Tag':'noindex, nofollow'}});
 if(request.method==='GET')return reply(await atelierStatus(store));
 let b;try{const raw=await request.text();if(raw.length>4096)throw Error();b=JSON.parse(raw);}catch{return reply({error:'INVALID_INPUT'},400);}
 if(b.action==='profile')return reply(await atelierStep(store,provider));
 const validId=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(s);
 if(b.action!=='feedback'||!validId(b.assetId)||!['like','pass','prefer','clear'].includes(b.verdict)||(b.verdict==='prefer'&&(!validId(b.otherId)||b.otherId===b.assetId)))return reply({error:'INVALID_FEEDBACK'},400);
 const other=b.verdict==='prefer'?b.otherId:'';
 const ids=[b.assetId,...(other?[other]:[])];
 return store.transaction(async c=>{
  const exists=(await c.query('SELECT asset_id FROM agent_visual_profiles WHERE asset_id=ANY($1::text[])',[ids])).rows;
  if(exists.length!==ids.length)return reply({error:'PROFILE_REQUIRED'},409);
  const key=other?'pair:'+ids.slice().sort().join(':'):'single:'+b.assetId;
  if(b.verdict==='clear')await c.query('DELETE FROM agent_taste_feedback WHERE id=$1',[key]);
  else await c.query('INSERT INTO agent_taste_feedback(id,asset_id,other_id,verdict) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET asset_id=excluded.asset_id,other_id=excluded.other_id,verdict=excluded.verdict,updated=now()',[key,b.assetId,other,b.verdict]);
  return reply({status:'saved'});
 });
}
