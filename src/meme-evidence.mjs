import {readFileSync} from 'node:fs';
export function currentMemeEvidence(now=new Date(),path=new URL('../private/meme-evidence.json',import.meta.url)) {
  try {
    const board=JSON.parse(readFileSync(path,'utf8'));
    const age=now.getTime()-Date.parse(board.observedAt);
    if(!Number.isFinite(age)||age<0||age>24*3600000||!Array.isArray(board.formats))return {status:'refresh_needed',formats:[]};
    return {status:'observed_not_causal',observedAt:board.observedAt,formats:board.formats};
  } catch {return {status:'refresh_needed',formats:[]};}
}
