import {loadReferences,referenceImageInstruction} from './visual-references.mjs';
import {AppearanceImage} from './appearance.mjs';

export const VIDEO_MODEL='google/veo-3.1-fast';
export const MAX_VIDEO_BYTES=14_000_000;
export function mediaCapabilities(env){return {image:!!env.GEMINI_API_KEY,video:!!(env.REPLICATE_API_TOKEN&&env.BLOB_READ_WRITE_TOKEN)};}
export function trustedMediaURL(value,blob=false){
 const u=new URL(value);const ok=blob?u.hostname.endsWith('.public.blob.vercel-storage.com'):(u.hostname==='replicate.delivery'||u.hostname.endsWith('.replicate.delivery'));
 if(u.protocol!=='https:'||u.username||u.password||u.port||!ok)throw Error('MEDIA_UNTRUSTED_URL');return u.href;
}
export async function readMedia(url,fetcher=fetch,blob=false){
 const r=await fetcher(trustedMediaURL(url,blob),{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('MEDIA_DOWNLOAD_FAILED');
 if(Number(r.headers.get('content-length'))>MAX_VIDEO_BYTES)throw Error('MEDIA_TOO_LARGE');
 const parts=[];let size=0;
 for await(const chunk of r.body){size+=chunk.length;if(size>MAX_VIDEO_BYTES)throw Error('MEDIA_TOO_LARGE');parts.push(Buffer.from(chunk));}
 const bytes=Buffer.concat(parts);if(bytes.length<12||bytes.toString('ascii',4,8)!=='ftyp')throw Error('MEDIA_INVALID_MP4');
 return {bytes,mime:'video/mp4'};
}
export class MediaProviders {
 constructor(env,fetcher=fetch){this.env=env;this.fetcher=fetcher;}
 imageQuote(prompt){return new AppearanceImage(this.env,this.fetcher).quote(prompt);}
 references(ids){return loadReferences(ids,this.fetcher);}
 image(prompt,ratio,refs=[]){return new AppearanceImage(this.env,this.fetcher).generate(refs.length?referenceImageInstruction+' Your chosen work: '+prompt:prompt,ratio,refs);}
 // Conservative upper reservation, not a claim of final provider billing.
 videoQuote(){return 4_000_000;}
 async replicate(method,path,body){
  if(!this.env.REPLICATE_API_TOKEN)throw Error('REPLICATE_NOT_CONFIGURED');
  const r=await this.fetcher('https://api.replicate.com/v1/'+path,{method,headers:{Authorization:'Bearer '+this.env.REPLICATE_API_TOKEN,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error('REPLICATE_HTTP_'+r.status);return r.json();
 }
 startVideo(plan){return this.replicate('POST','models/'+VIDEO_MODEL+'/predictions',{input:{prompt:plan.prompt,aspect_ratio:plan.ratio,duration:plan.duration,resolution:'720p',generate_audio:true}});}
 videoStatus(id){if(!/^[a-zA-Z0-9_-]+$/.test(id))throw Error('INVALID_PREDICTION');return this.replicate('GET','predictions/'+id);}
 async archiveVideo(id,output){
  const url=Array.isArray(output)?output[0]:output;
  const asset=await readMedia(url,this.fetcher);
  const {put}=await import('@vercel/blob');
  const saved=await put('generation_02/works/'+id+'.mp4',asset.bytes,{access:'public',contentType:asset.mime,addRandomSuffix:false,allowOverwrite:true,token:this.env.BLOB_READ_WRITE_TOKEN});
  return {mime:asset.mime,url:trustedMediaURL(saved.url,true)};
 }
 async load(asset){return asset.url?readMedia(asset.url,this.fetcher,true):{...asset,bytes:Buffer.from(asset.bytes)};}
}
