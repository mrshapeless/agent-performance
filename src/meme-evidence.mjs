import {readFileSync} from 'node:fs';
export function validateResearch(board,now=new Date()) {
  const age=now-Date.parse(board?.observedAt);
  if(!board?.id||!Number.isFinite(age)||age<0||age>=24*3600000||!Array.isArray(board.formats)||!board.formats.length)throw Error('RESEARCH_REQUIRED');
  const ids=new Set();
  for(const f of board.formats){
    if(!f.id||ids.has(f.id)||!['gaming','internet_culture'].includes(f.niche)||!['observed_format','current_conversation'].includes(f.evidenceType)||!f.topic||!f.recognition||!f.angle||!Array.isArray(f.sources)||!f.sources.length)throw Error('INVALID_RESEARCH');
    ids.add(f.id);
    for(const s of f.sources){
      const observed=now-Date.parse(s.observedAt),published=now-Date.parse(s.publishedAt);
      if(!/^https:\/\//.test(s.url)||!s.author||!s.observation||s.inspected!==true||!Number.isFinite(observed)||observed<0||observed>=24*3600000||!Number.isFinite(published)||published<0||(published>7*86400000&&!(f.evidenceType==='current_conversation'&&Math.abs(now-Date.parse(f.eventAt))<=3*86400000)))throw Error('INVALID_RESEARCH_SOURCE');
    }
    if(f.evidenceType==='observed_format'&&new Set(f.sources.map(s=>s.author)).size<2)throw Error('INSUFFICIENT_MEME_EVIDENCE');
  }
  return {...board,status:'observed_not_causal',refreshDue:age>=6*3600000};
}
export async function loadMemeResearch(store,now=new Date()) {
  const boards=[await store.latest('meme_research_internal'),currentMemeEvidence(now)].sort((a,b)=>Date.parse(b?.observedAt)-Date.parse(a?.observedAt));
  for(const board of boards){try{return validateResearch(board,now);}catch{}}
  return {status:'refresh_needed',formats:[]};
}
export function currentMemeEvidence(now=new Date(),path=new URL('../private/meme-evidence.json',import.meta.url)) {
  try {
    const board=JSON.parse(readFileSync(path,'utf8'));
    const age=now.getTime()-Date.parse(board.observedAt);
    if(!Number.isFinite(age)||age<0||age>24*3600000||!Array.isArray(board.formats))return {status:'refresh_needed',formats:[]};
    return {...board,status:'observed_not_causal'};
  } catch {return {status:'refresh_needed',formats:[]};}
}
