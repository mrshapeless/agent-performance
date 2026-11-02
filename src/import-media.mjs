import {CREATIVE_REVISION} from './creative-revision.mjs';
import {createHash} from 'node:crypto';

// Caller holds the migration transaction/advisory lock. Files are private build inputs.
export async function importApprovedMedia(client,store,batch,readAsset,now=new Date()){
 if(!batch)return [];
 if(!/^[a-z0-9-]{1,70}$/.test(batch.id)||!Array.isArray(batch.items)||batch.items.length>10||batch.items.length<1)throw Error('INVALID_MEDIA_IMPORT');
 const imported=[];
 for(let i=0;i<batch.items.length;i++){
  const item=batch.items[i];
  if(!/^[a-z0-9-]+\.mp4$/.test(item.file)||!Number.isSafeInteger(item.delayMinutes)||item.delayMinutes<0||item.delayMinutes>10080||typeof item.text!=='string'||!item.text.trim()||item.text.length>240||!/^[\x20-\x7e]+$/.test(item.text)||item.text.includes('@')||typeof item.alt!=='string'||!item.alt.trim()||item.alt.length>500||!/^[a-f0-9]{64}$/.test(item.sha256))throw Error('INVALID_MEDIA_IMPORT_ITEM');
  const id=`media-${batch.id}-${i+1}`,planId=`x-plan-${batch.id}-${i+1}`,assetId=id+'-asset';
  if((await client.query('SELECT id FROM agent_media_jobs WHERE id=$1',[id])).rows.length)continue;
  const bytes=await readAsset(item.file);
  if(!Buffer.isBuffer(bytes)||bytes.length>3500000||bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp'||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('INVALID_IMPORTED_VIDEO');
  const availableAt=new Date(now.getTime()+item.delayMinutes*60000).toISOString();
  const summary='This completed synthetic portrait clip and caption were commissioned and approved for X by the project owner. This is an editorial import, not autonomous creation or audience feedback.';
  const plan={creativeRevision:CREATIVE_REVISION,action:'x_draft',medium:'video',text:item.text,alt:item.alt,summary,ratio:'9:16',duration:5,intent:'editorial',provenance:'owner-approved-import',availableAt};
  await client.query('INSERT INTO agent_assets(id,mime,bytes) VALUES($1,$2,$3)',[assetId,'video/mp4',bytes]);
  await client.query("INSERT INTO agent_operations(id,kind,day,amount,status,result) VALUES($1,'step',(CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Moscow')::date,0,'complete',$2)",[planId,JSON.stringify(plan)]);
  await client.query("INSERT INTO agent_media_jobs(id,plan_id,plan,state,data,available_at) VALUES($1,$2,$3,'rendered',$4,$5)",[id,planId,JSON.stringify(plan),JSON.stringify({assetId,review:{decision:'publish',text:item.text,alt:item.alt,summary},importDigest:item.sha256}),availableAt]);
  await store.append(client,'art_video',{assetId,mime:'video/mp4',text:item.alt,alt:item.alt,summary:'Owner-approved clip queued for X, available from '+availableAt+'. '+summary});
  imported.push({id,availableAt});
 }
 return imported;
}
