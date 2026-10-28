import {MediaProviders,mediaCapabilities} from './media-providers.mjs';

export const VIDEO_CADENCE_TIMEZONE='Europe/Moscow';
const terminal=new Set(['published','failed','rejected']);
export function videoDay(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('INVALID_VIDEO_CADENCE_TIME');
 const day=new Intl.DateTimeFormat('en-CA',{timeZone:VIDEO_CADENCE_TIMEZONE,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
 // Moscow has a fixed UTC+3 offset for the supported operational dates.
 const start=new Date(day+'T00:00:00+03:00');
 return {day,start:start.toISOString(),end:new Date(start.getTime()+86400000).toISOString()};
}

export async function videoCadence(store,env,now=new Date(),quote=new MediaProviders(env).videoQuote()){
 if(!Number.isSafeInteger(quote)||quote<0)throw Error('INVALID_VIDEO_QUOTE');
 const window=videoDay(now),q=store.pool.query.bind(store.pool);
 const posts=(await q("SELECT seq,payload::jsonb AS payload FROM agent_events WHERE kind='x_post' AND payload::jsonb->>'mime'='video/mp4' AND created::timestamptz >= $1 AND created::timestamptz < $2",[window.start,window.end])).rows;
 const publications=new Set(posts.map(p=>p.payload.postId?'post:'+p.payload.postId:p.payload.assetId?'asset:'+p.payload.assetId:'event:'+p.seq));
 const publishedAssets=new Set(posts.map(p=>p.payload.assetId).filter(Boolean));
 const jobs=(await q("SELECT j.id,j.state,j.data,j.created,j.updated,o.status AS render_status,o.amount AS render_amount,o.day::text AS render_day FROM agent_media_jobs j LEFT JOIN agent_operations o ON o.id=j.id||'-render' WHERE j.plan->>'medium'='video' AND (j.state NOT IN ('published','failed','rejected') OR j.created >= $1 OR j.updated >= $1 OR o.day=$2::date)",[window.start,window.day])).rows;
 // Support legacy/manual imported jobs without double-counting the normal event+job pair.
 for(const j of jobs.filter(j=>j.state==='published'&&new Date(j.updated)>=new Date(window.start)&&new Date(j.updated)<new Date(window.end)&&!publishedAssets.has(j.data?.assetId))){
  const known=(await q("SELECT seq FROM agent_events WHERE kind='x_post' AND payload::jsonb->>'assetId'=$1 LIMIT 1",[j.data?.assetId??''])).rows.length;
  if(!known)publications.add('job:'+j.id);
 }
 const active=jobs.filter(j=>!terminal.has(j.state)).map(j=>({id:j.id,state:j.state}));
 const failedCharged=jobs.filter(j=>j.render_day===window.day&&Number(j.render_amount)>0&&['failed','rejected'].includes(j.state)).map(j=>j.id);
 const reserved=Number((await q("SELECT COALESCE(SUM(amount),0)::text AS reserved FROM agent_operations WHERE budget_provider='replicate' AND day=$1::date",[window.day])).rows[0].reserved);
 const count=publications.size,slot=count===0?1:2,claimId='video-cadence-'+window.day+'-'+slot;
 const claim=await store.operation(claimId);
 const state={...window,timezone:VIDEO_CADENCE_TIMEZONE,published:count,minimum:1,maximum:2,active,failedCharged,claimId,quoteMicrodollars:quote,reservedMicrodollars:reserved,limitMicrodollars:50_000_000,required:false,optional:false,status:'satisfied'};
 if(count>=2)return {...state,status:'daily_maximum'};
 if(active.length)return {...state,status:'in_progress'};
 if(failedCharged.length)return {...state,status:'needs_attention'};
 if(claim)return {...state,status:'already_attempted'};
 if(!mediaCapabilities(env).video)return {...state,status:'not_configured'};
 if(reserved+quote>state.limitMicrodollars)return {...state,status:'replicate_budget_unavailable'};
 return {...state,status:count===0?'required':'optional',required:count===0,optional:count===1};
}

// A claim is a planning idempotency marker, not a video, charge, or completed goal.
// It is written atomically without leaving an agent-lane operation pending on a crash.
export async function claimVideoCadence(store,env,now=new Date(),{optional=false,quote}={}){
 return store.transaction(async c=>{
  const readStore={pool:{query:c.query.bind(c)},operation:async id=>(await c.query('SELECT status,result FROM agent_operations WHERE id=$1',[id])).rows[0]??null};
  const state=await videoCadence(readStore,env,now,quote);
  if(!state.required&&!(optional&&state.optional))return {claimed:false,...state};
  await c.query("INSERT INTO agent_operations(id,kind,day,amount,status,result) VALUES($1,'step',$2,0,'complete',$3)",[state.claimId,state.day,JSON.stringify({action:'video_cadence_claimed',day:state.day,slot:state.published+1})]);
  return {claimed:true,...state};
 });
}

export function videoCadenceDirection(state){
 if(!state.required&&!state.optional)return '';
 return `${state.required?'A short film is due: no video has been published in the current Moscow day.':'One film has been published today; a second is optional only if a distinct idea benefits from motion.'} Select your own subject and purpose. Develop three genuinely different temporal concepts, then choose one. Describe a first-frame hook, an observable change or movement, and an ending, plus intentional audio or silence. These may be observational, abstract, funny, narrative or something else; no prescribed subject or motif. A 4-8 second film must work as moving images, not a still illustration with a generic camera push. Keep the existing visual remit through actual image construction rather than naming lo-fi over a polished scene. Use the selected screenplay in the executable video prompt. This is a format commitment, not a required storyline or a claim that generation/publication has succeeded.`;
}
