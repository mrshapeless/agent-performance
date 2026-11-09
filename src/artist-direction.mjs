import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

export const ARTIST_DIRECTION_REVISION='artist-projects-2026-11-09-v18';
export function loadArtistDirection(path=new URL('../private/artist-direction.json',import.meta.url)) {
  try {
    const v=JSON.parse(readFileSync(path,'utf8'));
    if(v.revision!==ARTIST_DIRECTION_REVISION||typeof v.brief!=='string'||!v.brief.trim()||typeof v.projectId!=='string'||!v.projectId.trim())return null;
    return v;
  } catch {return null;}
}
export function publicArtistDirection(direction=loadArtistDirection()) {
  return {revision:ARTIST_DIRECTION_REVISION,status:direction?'artist_release_required':'artist_direction_required',legacyOriginalsEnabled:false,briefLoaded:!!direction,fingerprint:direction?createHash('sha256').update(direction.brief).digest('hex'):null};
}
// The old short-caption generator is not a release adapter. Fail closed while
// preserving unknown external writes, which socialStep reconciles before here.
export async function artistReleaseStep(store,direction=loadArtistDirection()) {
  const status=publicArtistDirection(direction);
  if(!direction)return {status:status.status,revision:status.revision};
  const id=`artist-commission-${status.revision}-${status.fingerprint.slice(0,16)}`;
  const request=await store.begin(id,'step',()=>({maximum:0}));
  if(!request.replay)await store.complete(id,0,{action:'artist_commission_internal',revision:status.revision,projectId:direction.projectId,brief:direction.brief,manuscript:direction.manuscript??null,releaseState:'draft',requirements:['complete authored work','actual audiovisual review','supported delivery format','verified publication'],summary:'Private artistic commission retained; legacy short-caption generation is retired.'});
  return {status:status.status,revision:status.revision,commissionId:id};
}
