import {renderDirection} from './audience-direction.mjs';
// Gemini Nano Banana 2.1 tariffs checked against Google pricing on 2026-10-20.
export class AppearanceImage {
  constructor(env,fetcher=fetch){this.key=env.GEMINI_API_KEY;this.fetcher=fetcher;if(!this.key)throw Error('GEMINI_NOT_CONFIGURED');}
  quote(prompt){return Math.ceil((Buffer.byteLength(prompt)+2048)*1.5+8192*30);}
  async generate(prompt,ratio='1:1',references=[]){
    prompt=renderDirection+'\nSCENE: '+prompt;
    if(!['1:1','21:9','16:9','9:16'].includes(ratio))throw Error('IMAGE_INVALID_RATIO');
    const r=await this.fetcher('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':this.key},signal:AbortSignal.timeout(90000),body:JSON.stringify({model:'gemini-nano-banana-2.1',store:false,input:references.length?[{type:'text',text:prompt},...references.map(a=>({type:'image',mime_type:a.mime,data:Buffer.from(a.bytes).toString('base64')}))]:prompt,response_format:{type:'image',aspect_ratio:ratio,image_size:'1K',mime_type:'image/jpeg'},generation_config:{max_output_tokens:8192}})});
    if(!r.ok)throw Error('IMAGE_HTTP_'+r.status);const data=await r.json();
    if(data.status!=='completed')throw Error('IMAGE_INCOMPLETE');
    const images=(data.steps??[]).filter(s=>s.type==='model_output').flatMap(s=>s.content??[]).filter(p=>p.type==='image');
    if(images.length!==1||!['image/jpeg','image/png','image/webp'].includes(images[0].mime_type)||typeof images[0].data!=='string')throw Error('IMAGE_INVALID');
    const bytes=Buffer.from(images[0].data,'base64');if(!bytes.length||bytes.length>3_500_000)throw Error('IMAGE_TOO_LARGE');
    const u=data.usage;for(const k of ['total_input_tokens','total_output_tokens','total_thought_tokens'])if(!Number.isSafeInteger(u?.[k])||u[k]<0)throw Error('IMAGE_USAGE_MISSING');
    // Charge all generated tokens at the higher image tariff: conservative ledger estimate.
    const costMicrodollars=Math.ceil(u.total_input_tokens*1.5+(u.total_output_tokens+u.total_thought_tokens)*30);
    return {bytes,mime:images[0].mime_type,costMicrodollars};
  }
}

