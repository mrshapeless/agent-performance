import {renderDirection} from './audience-direction.mjs';
import {visualDirection} from './visual-contract.mjs';
import {loadReferences,referenceImageInstruction} from './visual-references.mjs';
import {AppearanceImage} from './appearance.mjs';
import {composeCollage} from './collage.mjs';

export const VIDEO_MODEL='google/veo-3.1-fast';
export const CHARACTER_MODEL='google/nano-banana';
export const CHARACTER_STYLE_REFERENCE='https://alidade.art/series/afterimage-03.jpg';
export const CHARACTER_ASSET='broadcast-avatar-v1';
export const MAX_VIDEO_BYTES=14_000_000;
export function mediaCapabilities(env){return {image:!!env.GEMINI_API_KEY,character:!!env.REPLICATE_API_TOKEN,video:!!(env.REPLICATE_API_TOKEN&&env.BLOB_READ_WRITE_TOKEN)};}
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
 collage(layout,sources,ratio){return composeCollage(layout,sources,ratio);}
 // Conservative upper reservation, not a claim of final provider billing.
 videoQuote(){return 4_000_000;}
 characterQuote(){return 100_000;}
 async startCharacter(plan,reference){
  const bytes=Buffer.from(reference?.bytes??[]);
  if(!['image/png','image/jpeg','image/webp'].includes(reference?.mime)||!bytes.length||bytes.length>5_000_000)throw Error('CHARACTER_REFERENCE_MISSING');
  return this.replicate('POST','models/'+CHARACTER_MODEL+'/predictions',{input:{
   image_input:['data:'+reference.mime+';base64,'+bytes.toString('base64'),CHARACTER_STYLE_REFERENCE],
   prompt:visualDirection+' '+renderDirection+' The first input defines Alidade identity. The second input is the approved OUT OF FRAME visual treatment: match its subdued color, diffuse natural light, soft camcorder capture and relaxed performance, not the older avatar lighting or shiny plastic rendering. Do not copy its beach, clothes or pose. Alidade is the established fictional AI artist. Preserve her recognizable elongated face, facial proportions, brown skin, center-parted white blunt bob with exposed forehead, NO fringe or bangs, and expressive gaze. Preserve the synthetic low-fidelity character of her face; do not replace her with a photoreal stock model. The reference is identity, not a required pose, clothing, background or color palette. Keep the complete approved face clearly visible in an opening frame. No hands, fabric, hair or props covering facial landmarks. Do not change facial proportions when smiling; do not substitute a generic realistic human. Create the following new authored scene: '+plan.prompt,
   aspect_ratio:plan.ratio,output_format:'png'}});
 }
 async archiveCharacter(output){
  const url=Array.isArray(output)?output[0]:output;
  const r=await this.fetcher(trustedMediaURL(url),{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!r.ok)throw Error('CHARACTER_DOWNLOAD_FAILED');
  if(Number(r.headers.get('content-length'))>14_000_000)throw Error('CHARACTER_TOO_LARGE');
  let size=0;const parts=[];
  for await(const chunk of r.body){size+=chunk.length;if(size>14_000_000)throw Error('CHARACTER_TOO_LARGE');parts.push(Buffer.from(chunk));}
  const sharp=(await import('sharp')).default;
  const source=Buffer.concat(parts),meta=await sharp(source,{limitInputPixels:20_000_000}).metadata();
  if(!['png','jpeg','webp'].includes(meta.format))throw Error('CHARACTER_INVALID_IMAGE');
  // Transport bounds only, not a cosmetic lo-fi filter.
  const bytes=await sharp(source).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:93}).toBuffer();
  if(bytes.length>3_500_000)throw Error('CHARACTER_TOO_LARGE');
  return {bytes,mime:'image/jpeg'};
 }
 async replicate(method,path,body){
  if(!this.env.REPLICATE_API_TOKEN)throw Error('REPLICATE_NOT_CONFIGURED');
  const r=await this.fetcher('https://api.replicate.com/v1/'+path,{method,headers:{Authorization:'Bearer '+this.env.REPLICATE_API_TOKEN,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  if(!r.ok)throw Error('REPLICATE_HTTP_'+r.status);return r.json();
 }
 startVideo(plan,firstFrame=null){
  const bytes=Buffer.from(firstFrame?.bytes??[]);
  if((firstFrame||plan.renderer==='character')&&(!['image/png','image/jpeg','image/webp'].includes(firstFrame?.mime)||!bytes.length||bytes.length>5_000_000))throw Error('VIDEO_FIRST_FRAME_MISSING');
  // Replicate google/veo-3.1-fast schema: `image` is the starting frame URI.
  // Send only the generated opening frame, never private style boards.
  return this.replicate('POST','models/'+VIDEO_MODEL+'/predictions',{input:{prompt:renderDirection+' '+visualDirection+' SCREENPLAY: '+plan.prompt,aspect_ratio:plan.ratio,duration:plan.duration,resolution:'720p',generate_audio:true,...(firstFrame?{image:'data:'+firstFrame.mime+';base64,'+bytes.toString('base64')}:{})}});
 }
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
