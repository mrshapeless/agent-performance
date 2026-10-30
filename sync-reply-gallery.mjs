import {readFile,writeFile,readdir,mkdir,realpath} from 'node:fs/promises';
import {resolve,basename,relative} from 'node:path';
import {createHash} from 'node:crypto';
import sharp from 'sharp';

// Only confirmed, already-public reply artwork enters this manifest.
// Never copy a journal, reference, prompt, or operator field to public output.
const arg=process.argv.indexOf('--logs');
if(arg<0||!process.argv[arg+1])throw Error('Pass --logs with the private reply journal directory');
const logs=await realpath(resolve(process.argv[arg+1]));
const output='public/gallery';await mkdir(output,{recursive:true});
const media=JSON.parse(await readFile('public-media.json','utf8'));
const allowed=new Set(JSON.parse(await readFile('public-files.json','utf8')));
const entries=new Map();const missing=[];const hashes=new Set();
for(const file of (await readdir(logs)).filter(f=>/^\d{4}-\d{2}-\d{2}T.*\.json$/.test(f)).sort().reverse()){
 const log=JSON.parse(await readFile(resolve(logs,file),'utf8'));
 for(const r of log.replies??[]){
  if(!r.art||!/^https:\/\/x\.com\/alidadenull\/status\/\d+$/.test(r.reply??''))continue;
  if(basename(r.art)!==r.art)throw Error('Artwork must be a journal-local filename');
  let source;try{source=await realpath(resolve(logs,r.art));}catch{missing.push(r.reply);continue;}
  if(relative(logs,source).startsWith('..'))throw Error('Artwork escapes journal directory');
  const id=r.reply.split('/').pop();if(entries.has(id))continue;
  const bytes=await sharp(source).rotate().resize({width:1600,height:1600,fit:'inside',withoutEnlargement:true}).jpeg({quality:86,mozjpeg:true}).toBuffer();
  const hash=createHash('sha256').update(bytes).digest('hex');if(hashes.has(hash))continue;hashes.add(hash);
  const target=`${output}/reply-${id}.jpg`;await writeFile(target,bytes);media[target]=hash;allowed.add(target);
  entries.set(id,{id,image:`/gallery/reply-${id}.jpg`,caption:String(r.text??'').slice(0,1000),published:r.reply,created:log.slot+':00:00Z',kind:'reply'});
 }
}
await writeFile('public/reply-gallery.json',JSON.stringify({works:[...entries.values()]},null,2)+'\n');
allowed.add('public/reply-gallery.json');
await writeFile('public-media.json',JSON.stringify(media,null,2)+'\n');
await writeFile('public-files.json',JSON.stringify([...allowed].sort(),null,2)+'\n');
console.log(JSON.stringify({publishedArtworks:entries.size,missingPublishedArt:missing}));
