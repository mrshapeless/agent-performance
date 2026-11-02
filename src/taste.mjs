// Interpretable visual descriptors, not embeddings or evidence of consciousness.
export const axes=['collage','surfaceDamage','softness','lightingMismatch','spatialDistortion','culturalRemix','graphicDensity','advertisingPolish'];
export const profileSchema={type:'object',properties:{observation:{type:'string'},traits:{type:'object',properties:Object.fromEntries(axes.map(k=>[k,{type:'number',minimum:0,maximum:1}])),required:axes,additionalProperties:false}},required:['observation','traits'],additionalProperties:false};
export function validateProfile(v){
 if(!v||typeof v.observation!=='string'||!v.observation.trim()||v.observation.length>1200||axes.some(k=>!Number.isFinite(v.traits?.[k])||v.traits[k]<0||v.traits[k]>1))throw Error('INVALID_VISUAL_PROFILE');
 return {version:'visual-traits-v1',observation:v.observation,traits:Object.fromEntries(axes.map(k=>[k,v.traits[k]]))};
}
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
const vector=p=>axes.map(k=>2*p.traits[k]-1);
function rowsFor(profiles,feedback){
 const byId=new Map(profiles.map(p=>[p.asset_id,p]));
 return feedback.flatMap(f=>{const a=byId.get(f.asset_id),b=byId.get(f.other_id);if(!a||(f.verdict==='prefer'&&!b))return [];
  const x=vector(a);return [{x:[...(b?x.map((v,i)=>v-vector(b)[i]):x),b?0:1],y:f.verdict==='pass'?0:1,assets:[f.asset_id,...(b?[f.other_id]:[])]}];});
}
function fit(rows){
 const w=Array(axes.length+1).fill(0);if(!rows.length)return w;
 // L2 logistic regression; pair rows implement Bradley–Terry comparisons.
 for(let step=0;step<240;step++){const g=w.map(v=>0.12*v);for(const r of rows){const e=sigmoid(dot(w,r.x))-r.y;r.x.forEach((v,i)=>g[i]+=e*v/rows.length);}w.forEach((_,i)=>w[i]-=0.3*g[i]);}return w;
}
export function trainTaste(profiles,feedback){
 const rows=rowsFor(profiles,feedback),weights=fit(rows);
 // Asset-disjoint holdout: never report training accuracy as validation.
 let validation=null;
 if(rows.length>=10){const ids=[...new Set(rows.flatMap(r=>r.assets))].sort(),hold=new Set(ids.filter((_,i)=>i%5===0));const test=rows.filter(r=>r.assets.every(id=>hold.has(id))),train=rows.filter(r=>r.assets.every(id=>!hold.has(id)));
  if(test.length>=2&&train.length>=5){const w=fit(train);validation={samples:test.length,brier:test.reduce((n,r)=>n+(sigmoid(dot(w,r.x))-r.y)**2,0)/test.length};}}
 return {version:'taste-logistic-v1',samples:rows.length,status:rows.length<5?'collecting':'provisional',weights,validation,rank:profiles.map(p=>({assetId:p.asset_id,score:sigmoid(dot(weights,[...vector(p),1]))})).sort((a,b)=>b.score-a.score)};
}
export function similarity(a,b){return 1-axes.reduce((n,k)=>n+Math.abs(a.traits[k]-b.traits[k]),0)/axes.length;}
export function tasteBrief(profiles,feedback){
 const m=trainTaste(profiles,feedback),byId=new Map(profiles.map(p=>[p.asset_id,p]));
 return {version:m.version,status:m.status,operatorJudgments:m.samples,validation:m.validation,
  tendencies:m.samples>=5?axes.map((axis,i)=>({axis,weight:Number(m.weights[i].toFixed(3))})):[],
  examples:m.samples?m.rank.slice(0,3).map(r=>({assetId:r.assetId,observation:byId.get(r.assetId).observation,estimate:Number(r.score.toFixed(3))})):[],
  recent:profiles.slice(0,6).map(p=>({assetId:p.asset_id,observation:p.observation,traits:p.traits})),
  use:'Private operator taste is one fallible signal, not audience preference or your own identity. Pixel descriptors are model observations. Do not quote private feedback publicly. Choose freely; reserve room for experiments outside preferences. Similar construction is not a duplicate subject. Never turn a positive example into a mandatory format. No aesthetic publication veto.'};
}
